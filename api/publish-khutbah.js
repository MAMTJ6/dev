// Vercel serverless function: automated khutbah pipeline on Neon, retiring
// the Google Sheet → Apps Script → CSV pipeline (khutbah/google_app_script/*.gs).
// That pipeline's bridge was a live Sheet formula (tajuk khutbah!A2 =
// 'link extractor'!A2) — any hand-correction replaced the formula with a
// plain value and silently broke automation; formula recalc never fires
// onEdit, so the cascade had to be a direct call. The manual_override flag
// below replaces that implicit formula/value distinction with an explicit
// lock. See khutbah/upgrade-plan.md + khutbah/DEV_NOTES.md.
//
// Automation-first: the Mon-9am cron computes next Friday, builds the mufti
// URL (Gregorian slug + Hijri via api.waktusolat.app/PHG03), scrapes date +
// title, upserts khutbah_weeks, and publishes khutbah/data/khutbah.json.
// Manual key-in is secondary: an admin edit sets manual_override=true and
// the cron skips that week (skipped_locked) until unlocked.
//
// Fail-safe (same rule as api/publish-news.js): NEVER publish an error
// string. On ANY failure the published JSON keeps last-good values; the
// error is recorded in scrape_error only, and an email alert goes out via
// the shared sender (admin/alert-send-pure.js, Resend).
//
// Two branches, split by query param (same convention as api/publish-news.js):
//   ?action=... — admin CRUD (cookie session via lib/db.js
//     requireAdmin(req,'khutbah')): list-weeks, save-week, toggle-lock,
//     get-settings, save-setting.
//   (no action) — generate & publish:
//     POST (cookie session) — admin "Jana & Terbitkan" click.
//     GET, Authorization: Bearer <CRON_SECRET> — Vercel cron (vercel.json),
//       actor_email = 'vercel-cron'. Fails closed if CRON_SECRET unset.
//
// Required Vercel env vars:
//   NEON_DATABASE_URL, AUTH_SECRET, GITHUB_TOKEN, GITHUB_REPO
// Optional (alerts degrade gracefully without them):
//   RESEND_API_KEY (shared sender), CRON_SECRET (GET path only)
//
// Neon version (2026-10-14): Supabase REST replaced with await sql().

const { sql, requireAdmin } = require('../lib/db');
const {
    MALAY_MONTHS,
    getNextFriday,
    toISODate,
    formatGregorianDate,
    parseHijriSlug,
    buildMuftiLink,
    buildWaktusolatUrl,
    buildMuftiLinkVariants,
    buildParentListings,
    extractFridayLink,
    buildSiriText,
    extractDateTitle,
    buildKhutbahJson,
} = require('../admin/khutbah/publish-khutbah-pure.js');

const { parseRecipients, shouldAlert, sendAlert } = require('../admin/alert-send-pure.js');

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const KHUTBAH_JSON_FILE = 'khutbah/data/khutbah.json';

// khutbah_settings keys the admin UI is allowed to write. The last_alert_*
// cache keys are server-written only (maybeAlert below).
const WRITABLE_SETTINGS = new Set(['alert_emails', 'alert_from']);

// Neon may return DATE as a Date object — normalize to YYYY-MM-DD so
// buildKhutbashJson's string sort and the published JSON keep the exact
// shape the Supabase-REST era produced (see api/kuliah.js#dateStr).
function dateStr(d) {
    if (d == null) return d;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

function normWeekRow(r) {
    return { ...r, friday_date: dateStr(r.friday_date) };
}

async function fetchWithTimeout(url, ms, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...(opts || {}), signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function pushJsonToGitHubIfChanged(ghHeaders, githubRepo, filePath, jsonObj, commitMessage) {
    const contentsRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, { headers: ghHeaders });
    if (!contentsRes.ok && contentsRes.status !== 404) {
        throw new Error(`Failed to read ${filePath} from GitHub (status ${contentsRes.status})`);
    }
    const newContent = JSON.stringify(jsonObj, null, 2);
    let currentSha;
    if (contentsRes.ok) {
        const contentsJson = await contentsRes.json();
        currentSha = contentsJson.sha;
        const existingContent = Buffer.from(contentsJson.content, 'base64').toString('utf8');
        if (existingContent.trim() === newContent.trim()) return { unchanged: true };
    }
    const commitBody = { message: commitMessage, content: Buffer.from(newContent, 'utf8').toString('base64'), branch: 'main' };
    if (currentSha) commitBody.sha = currentSha;
    const putRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${filePath}`, {
        method: 'PUT', headers: ghHeaders, body: JSON.stringify(commitBody),
    });
    if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(`Failed to push ${filePath}: ${errData.message || putRes.statusText}`);
    }
    return await putRes.json();
}

async function logKhutbah(entry) {
    try {
        await sql()`INSERT INTO khutbah_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${entry.actor_email}, ${entry.actor_name || null}, ${entry.action}, ${entry.target_label || null}, ${entry.detail || null})`;
    } catch (e) {
        console.error('khutbah_activity_log insert failed:', e); // never blocks the response
    }
}

// ─── Admin CRUD (?action=...) ────────────────────────────────────────────────
async function handleAdmin(req, res) {
    const action = String(req.query.action || '');
    const { error: authErr } = await requireAdmin(req, 'khutbah');
    if (authErr) return res.status(authErr).json({ error: 'unauthorized' });

    try {
        if (req.method === 'GET' && action === 'list-weeks') {
            const rows = await sql()`SELECT id, friday_date, source_url, siri_text, title, date_text, main_text, hijri_part, gregorian_part, manual_override, scrape_status, scrape_error, fetched_at, created_at, updated_at FROM khutbah_weeks ORDER BY friday_date DESC LIMIT 52`;
            return res.status(200).json({ rows: rows.map(normWeekRow) });
        }
        if (req.method === 'GET' && action === 'get-settings') {
            const keys = String(req.query.keys || 'alert_emails,alert_from,last_alert_at,last_alert_reason').split(',').map(s => s.trim()).filter(Boolean);
            const rows = keys.length
                ? await sql()`SELECT key, value FROM khutbah_settings WHERE key = ANY(${keys})`
                : await sql()`SELECT key, value FROM khutbah_settings`;
            const out = {};
            rows.forEach(r => { out[r.key] = r.value; });
            return res.status(200).json({ settings: out });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const b = req.body || {};

        // Manual edit (admin-verified: a row with a title is good to
        // display, so a stale auto-scrape failure is cleared — otherwise a
        // previous fetch_failed badge sticks forever, since neither this
        // save nor the locked publish path touches scrape_status).
        if (action === 'save-week') {
            const r = b.row || {};
            if (!r.id) return res.status(400).json({ error: 'missing id' });
            if (!r.source_url || !String(r.source_url).trim()) return res.status(400).json({ error: 'source_url required' });
            const hasTitle = !!(r.title && String(r.title).trim());
            if (hasTitle) {
                await sql()`UPDATE khutbah_weeks SET title = ${String(r.title).trim()}, date_text = ${r.date_text ? String(r.date_text).trim() || null : null}, main_text = ${r.main_text ? String(r.main_text).trim() || null : null}, source_url = ${String(r.source_url).trim()}, manual_override = ${!!r.manual_override}, scrape_status = 'ok', scrape_error = NULL, updated_at = NOW() WHERE id = ${r.id}`;
            } else {
                await sql()`UPDATE khutbah_weeks SET title = NULL, date_text = ${r.date_text ? String(r.date_text).trim() || null : null}, main_text = ${r.main_text ? String(r.main_text).trim() || null : null}, source_url = ${String(r.source_url).trim()}, manual_override = ${!!r.manual_override}, updated_at = NOW() WHERE id = ${r.id}`;
            }
            return res.status(200).json({ ok: true });
        }
        if (action === 'toggle-lock') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`UPDATE khutbah_weeks SET manual_override = ${!!b.lock}, updated_at = NOW() WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        if (action === 'save-setting') {
            if (!WRITABLE_SETTINGS.has(String(b.key))) return res.status(400).json({ error: 'bad key' });
            await sql()`UPDATE khutbah_settings SET value = ${String(b.value ?? '')}, updated_at = NOW() WHERE key = ${String(b.key)}`;
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error('/api/publish-khutbah admin failed:', e);
        return res.status(500).json({ error: 'server error', details: e.message });
    }
}

async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Admin CRUD branch ───────────────────────────────────────────────────
    if (req.query && req.query.action) {
        return handleAdmin(req, res);
    }

    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;
    if (!githubToken || !githubRepo) return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });

    let actorEmail, actorName = null;
    if (req.method === 'GET') {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) return res.status(500).json({ error: 'Server misconfiguration: CRON_SECRET not set' });
        if (req.headers.authorization !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Invalid cron credentials' });
        }
        actorEmail = 'vercel-cron';
    } else {
        // Cookie session (Google OAuth via /api/auth) — no Bearer JWT.
        const { admin, error: authErr } = await requireAdmin(req, 'khutbah');
        if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
        actorEmail = admin.email;
        actorName = admin.name || null;
    }

    const ghHeaders = {
        'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
    };

    // Settings (alert recipients/sender + spam-guard cache).
    let settings = {};
    try {
        const rows = await sql()`SELECT key, value FROM khutbah_settings`;
        rows.forEach(r => { settings[r.key] = r.value; });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch khutbah_settings from Neon', details: e.message });
    }

    const mytNow = new Date(Date.now() + MYT_OFFSET_MS);
    const friday = getNextFriday(mytNow);
    const fridayISO = toISODate(friday);
    const siriText = buildSiriText(friday);

    // Existing row for this Friday (drives locked-check + alert transition).
    let existing = null;
    try {
        const rows = await sql()`SELECT * FROM khutbah_weeks WHERE friday_date = ${fridayISO} LIMIT 1`;
        existing = rows[0] ? normWeekRow(rows[0]) : null;
    } catch (e) { console.error('khutbah_weeks lookup failed:', e); }

    async function publishCurrentJson(detail) {
        let all;
        try {
            all = await sql()`SELECT * FROM khutbah_weeks`;
        } catch (e) {
            throw new Error(`Failed to fetch khutbah_weeks: ${e.message}`);
        }
        const jsonOut = buildKhutbahJson(all.map(normWeekRow));
        const commit = await pushJsonToGitHubIfChanged(ghHeaders, githubRepo, KHUTBAH_JSON_FILE, jsonOut,
            '[Admin] Terbitkan khutbah');
        await logKhutbah({
            actor_email: actorEmail || 'unknown', actor_name: actorName,
            action: 'publish_khutbah', target_label: fridayISO,
            detail: commit.unchanged ? `${detail} (tiada perubahan)` : detail,
        });
        return { commit, jsonOut };
    }

    async function maybeAlert(code, stepDetail) {
        // Spam guard: transition-only for this week + 24h throttle.
        const wasOk = !existing || existing.scrape_status === 'ok' || !existing.scrape_status;
        const throttleOk = shouldAlert(settings.last_alert_at, { throttleHours: 24 });
        const baseDetail = `${code}: ${stepDetail}`;
        if (!wasOk || !throttleOk) {
            await logKhutbah({
                actor_email: actorEmail || 'unknown', actor_name: actorName,
                action: 'khutbah_scrape_failed', target_label: fridayISO,
                detail: `${baseDetail} (alert_suppressed)`,
            });
            return { sent: false, reason: 'alert_suppressed' };
        }
        const to = parseRecipients(settings.alert_emails || '');
        const result = await sendAlert({
            to,
            subject: `[Khutbah] Gagal — Jumaat ${fridayISO} (${code})`,
            text: [
                `Jumaat: ${fridayISO} (${siriText})`,
                `Kegagalan: ${baseDetail}`,
                `URL dicuba: ${buildMuftiLinkAttempt || '-'}`,
                `Tajuk terakhir baik: ${existing?.title || '-'}`,
                `Semak: /admin/khutbah/senarai.html`,
            ].join('\n'),
        }, { apiKey: process.env.RESEND_API_KEY, from: settings.alert_from });
        // Write back the spam-guard cache (never blocks).
        try {
            const nowIso = new Date().toISOString();
            await sql()`UPDATE khutbah_settings SET value = ${nowIso}, updated_at = ${nowIso} WHERE key = 'last_alert_at'`;
            await sql()`UPDATE khutbah_settings SET value = ${code}, updated_at = ${nowIso} WHERE key = 'last_alert_reason'`;
        } catch (e) { console.error('khutbah_settings alert cache write failed:', e); }
        await logKhutbah({
            actor_email: actorEmail || 'unknown', actor_name: actorName,
            action: 'khutbah_scrape_failed', target_label: fridayISO,
            detail: `${baseDetail} (${result.sent ? 'alert_sent' : result.reason})`,
        });
        return result;
    }

    // Locked row: explicit manual override — skip scrape AND alert entirely.
    if (existing?.manual_override) {
        const { commit } = await publishCurrentJson('Langkau (kunci manual)');
        await logKhutbah({
            actor_email: actorEmail || 'unknown', actor_name: actorName,
            action: 'khutbah_auto_generate', target_label: fridayISO,
            detail: 'skipped_locked — manual_override=true',
        });
        return res.status(200).json({ success: true, friday_date: fridayISO, skipped: 'locked', unchanged: !!commit.unchanged });
    }

    let buildMuftiLinkAttempt = null;

    // Step 1: Hijri via waktusolat (PHG03, Friday's own month + day-match).
    // Month-aware: the bare endpoint serves the current month only, so a
    // Friday in the next month used to day-match the wrong month's Hijri.
    let hijriSlug = null;
    try {
        const hijriRes = await fetchWithTimeout(buildWaktusolatUrl(friday), 8000);
        if (!hijriRes.ok) throw new Error(`waktusolat status ${hijriRes.status}`);
        const data = await hijriRes.json();
        const match = (data.prayers || []).find(p => p.day === friday.getDate());
        if (!match?.hijri) throw new Error(`no prayers entry for day ${friday.getDate()}`);
        hijriSlug = parseHijriSlug(match.hijri);
        if (!hijriSlug) throw new Error(`unparseable hijri "${match.hijri}"`);
    } catch (e) {
        const msg = `Hijri gagal: ${e.message}`;
        await upsertWeek(existing, {
            friday_date: fridayISO, source_url: buildMuftiLinkAttempt || existing?.source_url || '',
            siri_text: siriText, scrape_status: 'fetch_failed', scrape_error: msg, fetched_at: new Date().toISOString(),
        });
        const alert = await maybeAlert('HIJRI_FAIL', msg);
        try { await publishCurrentJson(`Kegagalan hijri (${alert.sent ? 'alert dihantar' : alert.reason})`); } catch (e2) { /* log below */ }
        return res.status(500).json({ success: false, friday_date: fridayISO, error: msg, alert: alert.reason });
    }

    // Step 2: fetch mufti page — primary, then alias variants (404-only),
    // then parent-listing walk (discovery). First 200 wins; non-404 errors
    // break the ladder immediately (network issue — retrying is pointless).
    // Extra budget applies ONLY in the rare 404 path: 2×5s aliases +
    // 2×6s listings + 10s discovered page (no maxDuration set in vercel.json,
    // defaults apply — typical runs that hit primary/alias stay far under).
    buildMuftiLinkAttempt = buildMuftiLink(friday, hijriSlug);
    let html = null;
    let via = 'primary';
    async function fetchOk(url, ms) {
        const r = await fetchWithTimeout(url, ms);
        if (!r.ok) {
            const err = new Error(`HTTP ${r.status}`);
            err.status = r.status;
            throw err;
        }
        return r.text();
    }
    try {
        try {
            html = await fetchOk(buildMuftiLinkAttempt, 12000);
        } catch (e) {
            if (e.status !== 404) throw e;
            const chain = ['primary 404'];
            let recovered = false;
            // Layer 1: alias variants (one alternate spelling per axis).
            for (const v of buildMuftiLinkVariants(friday, hijriSlug).slice(1)) {
                try {
                    html = await fetchOk(v.url, 5000);
                    buildMuftiLinkAttempt = v.url;
                    via = v.label;
                    recovered = true;
                    break;
                } catch (e2) {
                    if (e2.status !== 404) throw e2;
                    chain.push(`${v.label} 404`);
                }
            }
            // Layer 2: parent-listing walk (discovery).
            if (!recovered) {
                const gregTok = formatGregorianDate(friday).split('-')[1];
                for (const parent of buildParentListings(buildMuftiLink(friday, hijriSlug))) {
                    let listHtml;
                    try {
                        listHtml = await fetchOk(parent.url, 6000);
                    } catch (e3) {
                        chain.push(`${parent.label} ${e3.status ? 'HTTP_' + e3.status : 'fail'}`);
                        continue;
                    }
                    const found = extractFridayLink(listHtml, friday, gregTok, hijriSlug);
                    if (!found) { chain.push(`${parent.label} tiada`); continue; }
                    try {
                        html = await fetchOk(found.url, 10000);
                        buildMuftiLinkAttempt = found.url;
                        via = `discovery:${parent.label}:${found.matchHow}`;
                        recovered = true;
                        break;
                    } catch (e4) {
                        chain.push(`discovery ${e4.status ? 'HTTP_' + e4.status : 'fail'}`);
                    }
                }
            }
            if (!recovered) throw new Error(`HTTP 404 (${chain.join('; ')})`);
        }
    } catch (e) {
        const code = /HTTP 404/.test(e.message) ? 'HTTP_404' : (/HTTP (\d+)/.test(e.message) ? `HTTP_${e.message.match(/HTTP (\d+)/)[1]}` : 'FETCH_FAIL');
        const msg = `Mufti gagal: ${e.message} — ${buildMuftiLinkAttempt}`;
        await upsertWeek(existing, {
            friday_date: fridayISO, source_url: buildMuftiLinkAttempt, siri_text: siriText,
            gregorian_part: formatGregorianDate(friday), hijri_part: hijriSlug,
            scrape_status: 'fetch_failed', scrape_error: msg, fetched_at: new Date().toISOString(),
        });
        const alert = await maybeAlert(code, msg);
        try { await publishCurrentJson(`Kegagalan fetch (${alert.sent ? 'alert dihantar' : alert.reason})`); } catch (e2) {
            return res.status(500).json({ success: false, friday_date: fridayISO, error: `${msg}; publish juga gagal: ${e2.message}` });
        }
        return res.status(500).json({ success: false, friday_date: fridayISO, error: msg, alert: alert.reason });
    }

    // Step 3: regex extract (primary + fallback; miss → parse_failed, keep last-good).
    const { dateText, titleText, dateMatched, titleMatched } = extractDateTitle(html);
    if (!dateText || !titleText) {
        const msg = `Parse gagal (date:${dateMatched} title:${titleMatched}) — ${buildMuftiLinkAttempt}`;
        await upsertWeek(existing, {
            friday_date: fridayISO, source_url: buildMuftiLinkAttempt, siri_text: siriText,
            gregorian_part: formatGregorianDate(friday), hijri_part: hijriSlug,
            scrape_status: 'parse_failed', scrape_error: msg, fetched_at: new Date().toISOString(),
        });
        const alert = await maybeAlert('PARSE_FAIL', msg);
        try { await publishCurrentJson(`Kegagalan parse (${alert.sent ? 'alert dihantar' : alert.reason})`); } catch (e2) {
            return res.status(500).json({ success: false, friday_date: fridayISO, error: `${msg}; publish juga gagal: ${e2.message}` });
        }
        return res.status(500).json({ success: false, friday_date: fridayISO, error: msg, alert: alert.reason });
    }

    // Success: upsert scraped values (title/date refreshed, main_text preserved —
    // the mufti page has no theme-text field; main_text is manual-only).
    await upsertWeek(existing, {
        friday_date: fridayISO, source_url: buildMuftiLinkAttempt, siri_text: siriText,
        title: titleText, date_text: dateText,
        gregorian_part: formatGregorianDate(friday), hijri_part: hijriSlug,
        scrape_status: 'ok', scrape_error: null, fetched_at: new Date().toISOString(),
    });
    const { commit } = await publishCurrentJson(`"${titleText}" (via ${via} date:${dateMatched} title:${titleMatched})`);
    await logKhutbah({
        actor_email: actorEmail || 'unknown', actor_name: actorName,
        action: 'khutbah_scrape_ok', target_label: fridayISO,
        detail: `"${titleText}" (via ${via}) — ${buildMuftiLinkAttempt}`,
    });
    return res.status(200).json({
        success: true, friday_date: fridayISO, title: titleText, date_text: dateText,
        siri_text: siriText, source_url: buildMuftiLinkAttempt, via,
        dateMatched, titleMatched, unchanged: !!commit.unchanged,
    });
}

async function upsertWeek(existing, row) {
    const nowIso = new Date().toISOString();
    if (existing) {
        // Preserve title/date_text/main_text on failure paths (caller omits them).
        await sql()`UPDATE khutbah_weeks SET source_url = ${row.source_url}, siri_text = ${row.siri_text}, title = ${row.title !== undefined ? row.title : existing.title}, date_text = ${row.date_text !== undefined ? row.date_text : existing.date_text}, gregorian_part = ${row.gregorian_part !== undefined ? row.gregorian_part : existing.gregorian_part}, hijri_part = ${row.hijri_part !== undefined ? row.hijri_part : existing.hijri_part}, scrape_status = ${row.scrape_status}, scrape_error = ${row.scrape_error !== undefined ? row.scrape_error : existing.scrape_error}, fetched_at = ${row.fetched_at}, updated_at = ${nowIso} WHERE friday_date = ${row.friday_date}`;
    } else {
        await sql()`INSERT INTO khutbah_weeks (friday_date, source_url, siri_text, title, date_text, gregorian_part, hijri_part, scrape_status, scrape_error, fetched_at, updated_at) VALUES (${row.friday_date}, ${row.source_url}, ${row.siri_text}, ${row.title !== undefined ? row.title : null}, ${row.date_text !== undefined ? row.date_text : null}, ${row.gregorian_part !== undefined ? row.gregorian_part : null}, ${row.hijri_part !== undefined ? row.hijri_part : null}, ${row.scrape_status}, ${row.scrape_error !== undefined ? row.scrape_error : null}, ${row.fetched_at}, ${nowIso})`;
    }
}

module.exports = handler;
// Pure builders re-exported for ad-hoc node testing (same convention as
// api/publish-news.js) — tests/publish-khutbah.test.js imports them from here.
module.exports.MALAY_MONTHS = MALAY_MONTHS;
module.exports.parseHijriSlug = parseHijriSlug;
module.exports.buildMuftiLink = buildMuftiLink;
module.exports.buildWaktusolatUrl = buildWaktusolatUrl;
module.exports.buildMuftiLinkVariants = buildMuftiLinkVariants;
module.exports.buildParentListings = buildParentListings;
module.exports.extractFridayLink = extractFridayLink;
module.exports.extractDateTitle = extractDateTitle;
