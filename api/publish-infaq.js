// Vercel serverless function: infaq data layer + publisher on Neon.
// Replaces direct supabase-js calls from admin/infaq/*.js AND the old
// Supabase-REST publish flow. Single function (Hobby 12-function limit).
//
// Two branches, split by query param (same convention as api/publish-news.js):
//   ?action=... — admin CRUD (cookie session via lib/db.js
//     requireAdmin(req,'infaq')): list/save/delete for kutipan_mingguan +
//     perbelanjaan_bulanan + projek_kutipan, project management
//     (list/get/save/activate/delete/online-total), ringkasan stats.
//   ?target=... — publish (POST, cookie session):
//     target=monthly      → admin/infaq/data/monthly.json      (general infaq)
//     target=daily        → admin/infaq/data/daily.json         (active project's donations)
//     target=perbelanjaan → admin/infaq/data/perbelanjaan.json (expenses)
//     target=project&project=<uuid> → admin/infaq/data/<slug>_<uuid>.json
// Split into independently-triggerable publishes (2026-07-22) so, e.g.,
// recording an expense doesn't require also recomputing/republishing
// kutipan data, and vice versa — each has its own button + "last published"
// note. Reads infaq_projects/infaq_kutipan_mingguan/infaq_projek_kutipan/
// infaq_perbelanjaan_bulanan, computes the published JSON (weekly/monthly/
// yearly rollups + active project progress — never stored pre-summed, always
// derived from raw rows), and commits ONE file to GitHub per `target`.
// Field/key shapes mirror the real infaq.mamtj6.com reference site exactly,
// so a future public page (or migrating the path) stays cheap. The publish
// is always a full "as of now" snapshot, no month param.
//
// Required Vercel environment variables:
//   NEON_DATABASE_URL, AUTH_SECRET, GITHUB_TOKEN, GITHUB_REPO
//
// Neon version (2026-10-14): Supabase REST replaced with await sql().
// NUMERIC columns arrive as strings — every helper below already coerces
// with Number(). DATE columns may arrive as Date objects — normalized to
// YYYY-MM-DD at the boundary (see dateStr).

const { sql, requireAdmin } = require('../lib/db');

const BULAN = [
    'Januari','Februari','Mac','April','Mei','Jun',
    'Julai','Ogos','September','Oktober','November','Disember'
];
// Uppercase, Malay-correct abbreviations (NOT English "Mar" — Malay March is
// "Mac") — verified 2026-07-22 directly against the real infaq.mamtj6.com
// reference repo's live monthly.json/perbelanjaan.json output (its own
// DATA_STRUCTURE.md doc is stale on this point, don't trust it over the
// real files). Feeds both graf.<year>.labels AND every published `bulan`/
// `Bulan` field below via bulanIniLabel/bulanLepasLabel.
const BULAN_SHORT = ['JAN','FEB','MAC','APR','MEI','JUN','JUL','OGO','SEP','OKT','NOV','DIS'];

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia is UTC+8, no DST

const TARGETS = {
    monthly:      { file: 'admin/infaq/data/monthly.json',      commitMessage: '[Admin] Terbitkan kutipan mingguan infaq', action: 'publish_monthly' },
    daily:        { file: 'admin/infaq/data/daily.json',        commitMessage: '[Admin] Terbitkan kutipan projek infaq',   action: 'publish_daily' },
    perbelanjaan: { file: 'admin/infaq/data/perbelanjaan.json', commitMessage: '[Admin] Terbitkan perbelanjaan infaq',     action: 'publish_perbelanjaan' },
    project:      { commitMessage: '[Admin] Terbitkan projek',   action: 'publish_project' },
};

// ── Pure helpers (kept dependency-free for ad-hoc local testing, same
// philosophy as api/publish.js's exported functions) ────────────────────────

function sumJumlah(rows) {
    return rows.reduce((s, r) => s + Number(r.jumlah), 0);
}

function filterTahunBulan(rows, tahun, bulan) {
    return rows.filter(r => r.tahun === tahun && r.bulan === bulan);
}

function filterTahun(rows, tahun) {
    return rows.filter(r => r.tahun === tahun);
}

// Each row already IS one week's total (infaq_kutipan_mingguan) — no
// day-of-month math needed, just place each row's jumlah into its bucket.
// Missing weeks (no row) stay 0, matching the source Sheet's "-" cells.
function buildMingguBuckets(weekRowsForOneMonth) {
    const buckets = { Minggu1: 0, Minggu2: 0, Minggu3: 0, Minggu4: 0, Minggu5: 0 };
    weekRowsForOneMonth.forEach(r => { buckets[`Minggu${r.minggu}`] = Number(r.jumlah); });
    return buckets;
}

// 12-length yearly array. Works whether rows are already one-per-month
// (perbelanjaan) or still one-per-week and need summing up (kutipan) —
// accumulation (+=) handles both uniformly.
function buildYearlyGraf(rows, year) {
    const data = new Array(12).fill(0);
    rows.forEach(r => {
        if (r.tahun !== year) return;
        data[r.bulan - 1] += Number(r.jumlah);
    });
    return { tahun: String(year), labels: BULAN_SHORT.slice(), data };
}

// Running sum, resets implicitly per call (one call = one year's series) —
// used for perbelanjaan.json's dataKumulatif/JumlahKumulatif.
function computeCumulative(dataArray) {
    let running = 0;
    return dataArray.map(v => { running += v; return running; });
}

// Returns null (never fabricated zeros) when there's no active project —
// callers omit the `projek` key entirely in that case.
function computeProjectProgress(project, donationsForProject) {
    if (!project) return null;
    const terkumpul = sumJumlah(donationsForProject) + Number(project.online_total || 0);
    const target = Number(project.target_amount);
    const peratusan = target > 0 ? Math.round((terkumpul / target) * 100) : 0;
    return { NamaProjek: project.name, SasaranKutipan: target, JumlahTerkumpul: terkumpul, Peratusan: peratusan };
}

// Build a filesystem-safe filename stem from a project name: lowercase,
// collapse any run of non-alphanumeric/underscore/hyphen chars into a single
// hyphen, strip leading/trailing hyphens. "Projek Baharu" → "projek-baharu".
function slugifyProjectName(name) {
    return String(name || 'projek')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'projek';
}

// Neon may return DATE as a Date object — normalize to YYYY-MM-DD so
// published tarikh/launch_date keep the exact Supabase-REST-era shape
// (frontend builds `new Date(str + 'T00:00:00')` from these).
function dateStr(d) {
    if (d == null) return d;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

// GET-sha-then-PUT against the GitHub Contents API — same pattern as
// api/publish.js.
async function pushJsonToGitHub(ghHeaders, githubRepo, filePath, jsonObj, commitMessage) {
    const contentsRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, { headers: ghHeaders });
    if (!contentsRes.ok && contentsRes.status !== 404) {
        throw new Error(`Failed to read ${filePath} from GitHub (status ${contentsRes.status})`);
    }
    let currentSha;
    if (contentsRes.ok) {
        currentSha = (await contentsRes.json()).sha;
    }

    const commitBody = {
        message: commitMessage,
        content: Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8').toString('base64'),
        branch: 'main',
    };
    if (currentSha) commitBody.sha = currentSha;

    const putRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, {
        method: 'PUT', headers: ghHeaders, body: JSON.stringify(commitBody),
    });
    if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(`Failed to push ${filePath}: ${errData.message || putRes.statusText}`);
    }
    return putRes.json();
}

async function logInfaq(actorEmail, actorName, action, targetLabel, detail) {
    try {
        await sql()`INSERT INTO infaq_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${actorEmail || 'unknown'}, ${actorName}, ${action}, ${targetLabel}, ${detail})`;
    } catch (e) {
        console.error('infaq_activity_log insert failed:', e); // never blocks the publish response
    }
}

// ─── Admin CRUD (?action=...) ────────────────────────────────────────────────
async function handleAdmin(req, res) {
    const action = String(req.query.action || '');
    const { admin, error: authErr } = await requireAdmin(req, 'infaq');
    if (authErr) return res.status(authErr).json({ error: 'unauthorized' });

    try {
        // ── Kutipan mingguan ──
        if (req.method === 'GET' && action === 'list-kutipan') {
            const rows = await sql()`SELECT id, tahun, bulan, minggu, jumlah, created_at, updated_at FROM infaq_kutipan_mingguan ORDER BY tahun DESC, bulan DESC, minggu DESC`;
            return res.status(200).json({ rows });
        }
        // ── Perbelanjaan ──
        if (req.method === 'GET' && action === 'list-perbelanjaan') {
            const rows = await sql()`SELECT id, tahun, bulan, jumlah, created_at, updated_at FROM infaq_perbelanjaan_bulanan ORDER BY tahun DESC, bulan DESC`;
            return res.status(200).json({ rows });
        }
        // ── Projects (+ per-project donation totals, one round-trip) ──
        if (req.method === 'GET' && action === 'list-projects') {
            const projects = await sql()`SELECT id, name, target_amount, is_active, completed_at, launch_date, online_total, online_total_updated_at, created_at, updated_at FROM infaq_projects ORDER BY is_active DESC, created_at DESC`;
            const sums = await sql()`SELECT project_id, SUM(jumlah)::float8 AS total FROM infaq_projek_kutipan GROUP BY project_id`;
            const totals = {};
            sums.forEach(s => { totals[s.project_id] = Number(s.total || 0); });
            return res.status(200).json({
                projects: projects.map(p => ({
                    ...p,
                    launch_date: dateStr(p.launch_date),
                    online_total_updated_at: dateStr(p.online_total_updated_at),
                    terkumpul: (totals[p.id] || 0) + Number(p.online_total || 0),
                })),
            });
        }
        // ── Single project ──
        if (req.method === 'GET' && action === 'get-project') {
            const rows = await sql()`SELECT id, name, target_amount, is_active, completed_at, launch_date, online_total, online_total_updated_at, created_at, updated_at FROM infaq_projects WHERE id = ${req.query.id} LIMIT 1`;
            if (!rows[0]) return res.status(404).json({ error: 'not found' });
            const p = rows[0];
            return res.status(200).json({ project: { ...p, launch_date: dateStr(p.launch_date), online_total_updated_at: dateStr(p.online_total_updated_at) } });
        }
        // ── Active project + its total (ringkasan.js) ──
        if (req.method === 'GET' && action === 'active-project') {
            const rows = await sql()`SELECT id, name, target_amount, is_active, online_total FROM infaq_projects WHERE is_active = true LIMIT 1`;
            if (!rows[0]) return res.status(200).json({ project: null });
            const sums = await sql()`SELECT SUM(jumlah)::float8 AS total FROM infaq_projek_kutipan WHERE project_id = ${rows[0].id}`;
            return res.status(200).json({ project: rows[0], total: Number(sums[0].total || 0) });
        }
        // ── Donations page (newest-first + exact total for stable Bil. + full sum for progress) ──
        if (req.method === 'GET' && action === 'list-donations') {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
            const rows = await sql()`SELECT id, project_id, tarikh, jumlah, keterangan, created_at, updated_at FROM infaq_projek_kutipan WHERE project_id = ${req.query.project_id} ORDER BY tarikh DESC, created_at DESC LIMIT ${limit}`;
            const counts = await sql()`SELECT COUNT(*)::int AS n, SUM(jumlah)::float8 AS s FROM infaq_projek_kutipan WHERE project_id = ${req.query.project_id}`;
            return res.status(200).json({
                rows: rows.map(r => ({ ...r, tarikh: dateStr(r.tarikh) })),
                total: counts[0].n,
                sum: Number(counts[0].s || 0),
            });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const b = req.body || {};

        // ── Kutipan save (upsert on natural key) ──
        if (action === 'save-kutipan') {
            const r = b.row || {};
            const tahun = parseInt(r.tahun, 10), bulan = parseInt(r.bulan, 10), minggu = parseInt(r.minggu, 10);
            const jumlah = Number(r.jumlah);
            if (!tahun || tahun < 2000 || !(bulan >= 1 && bulan <= 12) || !(minggu >= 1 && minggu <= 5)) {
                return res.status(400).json({ error: 'bad tahun/bulan/minggu' });
            }
            if (!(jumlah > 0)) return res.status(400).json({ error: 'jumlah must be > 0' });
            await sql()`INSERT INTO infaq_kutipan_mingguan (tahun, bulan, minggu, jumlah, updated_at) VALUES (${tahun}, ${bulan}, ${minggu}, ${jumlah}, NOW())
                ON CONFLICT (tahun, bulan, minggu) DO UPDATE SET jumlah = EXCLUDED.jumlah, updated_at = NOW()`;
            return res.status(200).json({ ok: true });
        }
        if (action === 'delete-kutipan') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM infaq_kutipan_mingguan WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Perbelanjaan save (upsert on natural key) ──
        if (action === 'save-perbelanjaan') {
            const r = b.row || {};
            const tahun = parseInt(r.tahun, 10), bulan = parseInt(r.bulan, 10);
            const jumlah = Number(r.jumlah);
            if (!tahun || tahun < 2000 || !(bulan >= 1 && bulan <= 12)) {
                return res.status(400).json({ error: 'bad tahun/bulan' });
            }
            if (!(jumlah > 0)) return res.status(400).json({ error: 'jumlah must be > 0' });
            await sql()`INSERT INTO infaq_perbelanjaan_bulanan (tahun, bulan, jumlah, updated_at) VALUES (${tahun}, ${bulan}, ${jumlah}, NOW())
                ON CONFLICT (tahun, bulan) DO UPDATE SET jumlah = EXCLUDED.jumlah, updated_at = NOW()`;
            return res.status(200).json({ ok: true });
        }
        if (action === 'delete-perbelanjaan') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM infaq_perbelanjaan_bulanan WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Project save (new projects start inactive — activating is the
        // explicit activate-project step, so a draft never silently
        // deactivates the current active project) ──
        if (action === 'save-project') {
            const r = b.row || {};
            if (!r.name || !String(r.name).trim()) return res.status(400).json({ error: 'name required' });
            if (!(Number(r.target_amount) > 0)) return res.status(400).json({ error: 'target_amount must be > 0' });
            const launch = r.launch_date ? String(r.launch_date).slice(0, 10) || null : null;
            if (r.id) {
                await sql()`UPDATE infaq_projects SET name = ${String(r.name).trim()}, target_amount = ${Number(r.target_amount)}, launch_date = ${launch}, updated_at = NOW() WHERE id = ${r.id}`;
            } else {
                await sql()`INSERT INTO infaq_projects (name, target_amount, launch_date, is_active) VALUES (${String(r.name).trim()}, ${Number(r.target_amount)}, ${launch}, false)`;
            }
            return res.status(200).json({ ok: true });
        }
        // ── Activate (deactivate current FIRST so the partial unique index
        // on is_active is never transiently violated) ──
        if (action === 'activate-project') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`UPDATE infaq_projects SET is_active = false, completed_at = NOW(), updated_at = NOW() WHERE is_active = true`;
            await sql()`UPDATE infaq_projects SET is_active = true, completed_at = NULL, updated_at = NOW() WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Delete project (blocked while donations reference it — the FK
        // is SET NULL, but silently orphaning attribution is data loss) ──
        if (action === 'delete-project') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            const counts = await sql()`SELECT COUNT(*)::int AS n FROM infaq_projek_kutipan WHERE project_id = ${b.id}`;
            if (counts[0].n > 0) return res.status(409).json({ error: 'referenced', count: counts[0].n });
            await sql()`DELETE FROM infaq_projects WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Online total edit ──
        if (action === 'save-online-total') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            const amount = b.online_total === null || b.online_total === '' ? null : Number(b.online_total);
            if (amount !== null && !(amount >= 0)) return res.status(400).json({ error: 'bad online_total' });
            const dt = b.online_total_updated_at ? String(b.online_total_updated_at).slice(0, 10) || null : null;
            await sql()`UPDATE infaq_projects SET online_total = ${amount}, online_total_updated_at = ${dt}, updated_at = NOW() WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Donation save/delete ──
        if (action === 'save-donation') {
            const r = b.row || {};
            if (!r.project_id) return res.status(400).json({ error: 'missing project_id' });
            if (!r.tarikh || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.tarikh))) return res.status(400).json({ error: 'bad tarikh' });
            if (!(Number(r.jumlah) > 0)) return res.status(400).json({ error: 'jumlah must be > 0' });
            const ket = r.keterangan ? String(r.keterangan).trim() || null : null;
            if (r.id) {
                await sql()`UPDATE infaq_projek_kutipan SET tarikh = ${String(r.tarikh)}, jumlah = ${Number(r.jumlah)}, keterangan = ${ket}, updated_at = NOW() WHERE id = ${r.id}`;
            } else {
                await sql()`INSERT INTO infaq_projek_kutipan (project_id, tarikh, jumlah, keterangan) VALUES (${r.project_id}, ${String(r.tarikh)}, ${Number(r.jumlah)}, ${ket})`;
            }
            return res.status(200).json({ ok: true });
        }
        if (action === 'delete-donation') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM infaq_projek_kutipan WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error('/api/publish-infaq admin failed:', e);
        return res.status(500).json({ error: 'server error', details: e.message });
    }
}

async function handler(req, res) {
    // ── CORS ────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Admin CRUD branch (GET reads + POST writes — must come BEFORE the
    // POST-only publish guard below) ────────────────────────────────────────
    if (req.query && req.query.action) {
        return handleAdmin(req, res);
    }

    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

    // ── 0. Validate target ──────────────────────────────────────────────────
    const target = req.query.target;
    if (!TARGETS[target]) {
        return res.status(400).json({ error: 'Missing or invalid target — expected ?target=monthly|daily|perbelanjaan|project' });
    }
    const projectId = target === 'project' ? req.query.project : null;
    if (target === 'project' && !projectId) {
        return res.status(400).json({ error: 'Missing project param — expected ?target=project&project=<uuid>' });
    }

    // ── 1. Verify session (cookie, Google OAuth via /api/auth) ──────────────
    const { admin, error: authErr } = await requireAdmin(req, 'infaq');
    if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
    const actorEmail = admin.email;
    const actorName = admin.name || null;

    // ── 2. Compute "now" in Malaysia time ───────────────────────────────────
    const mytNow = new Date(Date.now() + MYT_OFFSET_MS);
    const year   = mytNow.getUTCFullYear();
    const month  = mytNow.getUTCMonth() + 1;
    let lastMonthYear = year, lastMonth = month - 1;
    if (lastMonth < 1) { lastMonth = 12; lastMonthYear = year - 1; }

    // Short, uppercase, no-year form (e.g. "JUN") — matches the real
    // infaq.mamtj6.com reference site's published `bulan`/`Bulan` fields
    // exactly (verified 2026-07-22 against its live output). Used for every
    // externally-published bulan/Bulan field below.
    const bulanIniLabel   = BULAN_SHORT[month - 1];
    const bulanLepasLabel = BULAN_SHORT[lastMonth - 1];

    // Separate, human-readable "Month Year" label — only for THIS admin
    // CMS's own infaq_activity_log target_label (shown in userlog.html /
    // the "last published" note), never published externally. Kept decoupled
    // from bulanIniLabel so matching the external JSON's terser format
    // doesn't regress the admin's own log readability.
    const activityMonthLabel = `${BULAN[month - 1]} ${year}`;

    // ── 3. Fetch only what this target needs, compute its JSON ─────────────
    let jsonOut, activityLabel, activityDetail;
    // Only ever set by the `daily` branch below — data.json mirrors
    // daily.json's `projek` (same source query, same publish click)
    // deliberately: those are two projections of the SAME fact (current
    // active-project progress). Publishing them from separate buttons/targets
    // would let them drift out of sync with each other. See admin/developer.md.
    let extraPush = null;

    try {
        if (target === 'monthly') {
            const kutipanRows = await sql()`SELECT tahun, bulan, minggu, jumlah FROM infaq_kutipan_mingguan`;

            jsonOut = {
                ringkasan: {
                    kutipan: {
                        bulanIni:   { bulan: bulanIniLabel,   jumlah: sumJumlah(filterTahunBulan(kutipanRows, year, month)) },
                        bulanLepas: { bulan: bulanLepasLabel, jumlah: sumJumlah(filterTahunBulan(kutipanRows, lastMonthYear, lastMonth)) },
                        tahunIni:   { tahun: year,     jumlah: sumJumlah(filterTahun(kutipanRows, year)) },
                        tahunLepas: { tahun: year - 1, jumlah: sumJumlah(filterTahun(kutipanRows, year - 1)) },
                    },
                },
                paparanBulanIni: {
                    Tahun: year, Bulan: bulanIniLabel,
                    ...buildMingguBuckets(filterTahunBulan(kutipanRows, year, month)),
                    JumlahBulanan: sumJumlah(filterTahunBulan(kutipanRows, year, month)),
                },
                paparanBulanLepas: {
                    Tahun: lastMonthYear, Bulan: bulanLepasLabel,
                    ...buildMingguBuckets(filterTahunBulan(kutipanRows, lastMonthYear, lastMonth)),
                    JumlahBulanan: sumJumlah(filterTahunBulan(kutipanRows, lastMonthYear, lastMonth)),
                },
                // Every year present in infaq_kutipan_mingguan, not just year/
                // year - 1 — the reference frontend's year-dropdown just does
                // Object.keys(graf), it was never hardcoded to 2 years.
                graf: (() => {
                    const grafYears = new Set(kutipanRows.map(r => r.tahun));
                    grafYears.add(year);
                    grafYears.add(year - 1);
                    const grafByYear = {};
                    grafYears.forEach(y => { grafByYear[String(y)] = buildYearlyGraf(kutipanRows, y); });
                    return grafByYear;
                })(),
                tarikhKemaskini: new Date().toISOString(),
            };
            activityLabel  = activityMonthLabel;
            activityDetail = `Kutipan: RM ${jsonOut.ringkasan.kutipan.bulanIni.jumlah.toFixed(2)}`;

        } else if (target === 'daily') {
            const projRows = await sql()`SELECT * FROM infaq_projects WHERE is_active = true LIMIT 1`;
            const activeProject = projRows[0] || null;

            let projectDonations = [];
            if (activeProject) {
                projectDonations = await sql()`SELECT tarikh, jumlah, keterangan FROM infaq_projek_kutipan WHERE project_id = ${activeProject.id} ORDER BY tarikh ASC`;
            }

            const projectProgress = computeProjectProgress(activeProject, projectDonations);
            jsonOut = {
                ...(projectProgress ? { projek: projectProgress } : {}),
                paparanHarian: projectDonations.map(r => ({
                    tarikh: dateStr(r.tarikh), jumlah: Number(r.jumlah), keterangan: r.keterangan || '',
                })),
                tarikhKemaskini: new Date().toISOString(),
            };
            activityLabel  = activeProject?.name || 'Tiada projek aktif';
            activityDetail = projectProgress ? `Terkumpul: RM ${projectProgress.JumlahTerkumpul.toFixed(2)}` : null;

            // data.json feeds the real infaq.mamtj6.com reference site's
            // homepage (loadDashboard()) — never fabricate it when there's no
            // active project, same "never fabricated zeros" rule
            // computeProjectProgress() itself already follows.
            if (projectProgress) {
                extraPush = {
                    file: 'admin/infaq/data/data.json',
                    commitMessage: '[Admin] Terbitkan projek infaq (data.json)',
                    jsonObj: {
                        projek: { ...projectProgress, TarikhKemaskini: activeProject.updated_at },
                        tarikhKemaskini: new Date().toISOString(),
                    },
                };
            }

        } else if (target === 'project') {
            const projRows = await sql()`SELECT * FROM infaq_projects WHERE id = ${projectId} LIMIT 1`;
            const projRow = projRows[0] || null;
            if (!projRow) return res.status(404).json({ error: 'Project not found' });

            const projDonations = await sql()`SELECT tarikh, jumlah, keterangan FROM infaq_projek_kutipan WHERE project_id = ${projectId} ORDER BY tarikh ASC`;

            const projProgress = computeProjectProgress(projRow, projDonations);
            jsonOut = {
                ...(projProgress ? { projek: projProgress } : {}),
                paparanHarian: projDonations.map(r => ({
                    tarikh: dateStr(r.tarikh), jumlah: Number(r.jumlah), keterangan: r.keterangan || '',
                })),
                tarikhKemaskini: new Date().toISOString(),
            };
            activityLabel  = projRow.name;
            activityDetail = projProgress ? `Terkumpul: RM ${projProgress.JumlahTerkumpul.toFixed(2)}` : null;

        } else { // perbelanjaan
            const perbelanjaanRows = await sql()`SELECT tahun, bulan, jumlah FROM infaq_perbelanjaan_bulanan`;

            // Publish a graf entry for EVERY year present in the table, not just
            // the current one — the reference frontend's year-dropdown does
            // Object.keys(graf) and shows whatever's there. Current and
            // previous year are always included even with zero rows, so
            // paparanBulanIni/Lepas below always have a series to read from.
            const grafYears = new Set(perbelanjaanRows.map(r => r.tahun));
            grafYears.add(year);
            grafYears.add(year - 1);

            const grafByYear = {};
            grafYears.forEach(y => {
                const yearGraf = buildYearlyGraf(perbelanjaanRows, y);
                grafByYear[String(y)] = { ...yearGraf, dataKumulatif: computeCumulative(yearGraf.data) };
            });

            const cumulativeThisYear = grafByYear[String(year)].dataKumulatif;
            // January edge case: "bulan lepas" is December of the PREVIOUS year,
            // so its cumulative must come from that year's own series, not
            // carried over from the current year's array (resets at the boundary).
            const bulanLepasKumulatif = grafByYear[String(lastMonthYear)].dataKumulatif[lastMonth - 1];

            jsonOut = {
                ringkasan: {
                    perbelanjaan: {
                        tahunIni:   { tahun: year,     jumlah: sumJumlah(filterTahun(perbelanjaanRows, year)) },
                        tahunLepas: { tahun: year - 1, jumlah: sumJumlah(filterTahun(perbelanjaanRows, year - 1)) },
                        bulanIni:   { bulan: bulanIniLabel,   jumlah: sumJumlah(filterTahunBulan(perbelanjaanRows, year, month)) },
                        bulanLepas: { bulan: bulanLepasLabel, jumlah: sumJumlah(filterTahunBulan(perbelanjaanRows, lastMonthYear, lastMonth)) },
                    },
                },
                paparanBulanIni: {
                    Tahun: year, Bulan: bulanIniLabel,
                    Jumlah: sumJumlah(filterTahunBulan(perbelanjaanRows, year, month)),
                    JumlahKumulatif: cumulativeThisYear[month - 1],
                },
                paparanBulanLepas: {
                    Tahun: lastMonthYear, Bulan: bulanLepasLabel,
                    Jumlah: sumJumlah(filterTahunBulan(perbelanjaanRows, lastMonthYear, lastMonth)),
                    JumlahKumulatif: bulanLepasKumulatif,
                },
                graf: grafByYear,
                tarikhKemaskini: new Date().toISOString(),
            };
            activityLabel  = activityMonthLabel;
            activityDetail = `Perbelanjaan: RM ${jsonOut.ringkasan.perbelanjaan.bulanIni.jumlah.toFixed(2)}`;
        }
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch data from Neon', details: e.message });
    }

    // ── 4. Push the file(s) to GitHub ───────────────────────────────────────
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo  = process.env.GITHUB_REPO;
    if (!githubToken || !githubRepo) {
        return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });
    }
    const ghHeaders = {
        'Authorization':        `Bearer ${githubToken}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
    };

    const { commitMessage, action } = TARGETS[target];
    // project target: human-readable name + UUID suffix so the file is both
    // recognisable at a glance and collision-proof/stable across a rename.
    let file;
    if (target === 'project' && jsonOut?.projek?.NamaProjek) {
        file = `admin/infaq/data/${slugifyProjectName(jsonOut.projek.NamaProjek)}_${projectId}.json`;
    } else if (target === 'project') {
        file = `admin/infaq/data/${projectId}.json`;
    } else {
        file = TARGETS[target].file;
    }
    let commit;
    try {
        commit = await pushJsonToGitHub(ghHeaders, githubRepo, file, jsonOut, commitMessage);
    } catch (e) {
        return res.status(500).json({ error: 'Failed to push to GitHub', details: e.message });
    }

    // data.json (target=daily only) — a second commit from the same
    // request/query, so it can never disagree with the daily.json commit
    // that just landed.
    if (extraPush) {
        try {
            await pushJsonToGitHub(ghHeaders, githubRepo, extraPush.file, extraPush.jsonObj, extraPush.commitMessage);
        } catch (e) {
            return res.status(500).json({ error: 'Failed to push data.json', details: e.message });
        }
    }

    // ── 5. Activity log (never blocks the response) ────────────────────────
    await logInfaq(actorEmail, actorName, action, activityLabel, activityDetail);

    return res.status(200).json({
        success: true,
        target,
        commitUrl: commit.commit?.html_url ?? null,
    });
};

module.exports = handler;
module.exports.sumJumlah              = sumJumlah;
module.exports.filterTahunBulan       = filterTahunBulan;
module.exports.filterTahun            = filterTahun;
module.exports.buildMingguBuckets     = buildMingguBuckets;
module.exports.buildYearlyGraf        = buildYearlyGraf;
module.exports.computeCumulative      = computeCumulative;
module.exports.computeProjectProgress = computeProjectProgress;
module.exports.slugifyProjectName     = slugifyProjectName;
