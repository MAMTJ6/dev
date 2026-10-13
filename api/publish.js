// Vercel serverless function: POST /api/publish?month=YYYY-MM
// Reads schedule from NEON, merges it into jadual_lengkap_v2.json's
// months map (keyed by real current/next YYYY-MM), commits to GitHub.
//
// Required Vercel environment variables:
//   NEON_DATABASE_URL — Neon pooled connection string
//   AUTH_SECRET       — session signing secret (lib/db.js)
//   GITHUB_TOKEN      — fine-grained PAT with contents:write on MAMTJ6/dev
//   GITHUB_REPO       — "MAMTJ6/dev"

const { sql, requireAdmin } = require('../lib/db');

const BULAN = [
    'Januari','Februari','Mac','April','Mei','Jun',
    'Julai','Ogos','September','Oktober','November','Disember'
];

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia is UTC+8, no DST

// ── Pure helpers (kept dependency-free for ad-hoc local testing) ────────────

function computeRealMonthKeys(mytNow) {
    const y = mytNow.getUTCFullYear();
    const m = mytNow.getUTCMonth() + 1; // 1-12
    const realCurrentKey = `${y}-${String(m).padStart(2, '0')}`;
    let ny = y, nm = m + 1;
    if (nm > 12) { nm = 1; ny++; }
    const realNextKey = `${ny}-${String(nm).padStart(2, '0')}`;
    return { realCurrentKey, realNextKey };
}

function monthLabelFromKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return `${BULAN[m - 1]} ${y}`;
}

function inferMonthKeyFromTajuk(tajukBulan) {
    if (typeof tajukBulan !== 'string') return null;
    const m = tajukBulan.match(/BULAN\s+([A-Za-z]+)\s+(\d{4})/i);
    if (!m) return null;
    const idx = BULAN.findIndex(name => name.toUpperCase() === m[1].toUpperCase());
    if (idx === -1) return null;
    return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

// Parses the existing file's base64 content into a `months` map, migrating
// the old single-month flat schema if that's what's currently published.
// Never throws — any unrecognized/corrupt content just yields an empty map.
function buildMonthsStoreFromExisting(base64Content) {
    if (!base64Content) return {};

    let parsed;
    try {
        const decoded = Buffer.from(base64Content, 'base64').toString('utf8');
        parsed = JSON.parse(decoded);
    } catch (e) {
        return {};
    }

    if (parsed && typeof parsed.months === 'object' && parsed.months !== null && !Array.isArray(parsed.months)) {
        return { ...parsed.months };
    }

    if (parsed && parsed.infoJadual && Array.isArray(parsed.senaraiHari)) {
        const inferredKey = inferMonthKeyFromTajuk(parsed.infoJadual.tajukBulan);
        if (inferredKey) {
            return { [inferredKey]: { infoJadual: parsed.infoJadual, senaraiHari: parsed.senaraiHari } };
        }
    }

    return {};
}

// Merges `newMonthEntry` into `monthsStore[month]`, then drops every key that
// isn't the real-current or real-next month so the file never accumulates
// stale/unbounded history.
function mergeAndPruneMonthsStore(monthsStore, month, newMonthEntry, realCurrentKey, realNextKey) {
    const merged = { ...monthsStore, [month]: newMonthEntry };
    for (const key of Object.keys(merged)) {
        if (key !== realCurrentKey && key !== realNextKey) delete merged[key];
    }
    return merged;
}

// Neon node-postgres may return DATE as a Date — normalize to YYYY-MM-DD.
function dateStr(d) {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

module.exports = async function handler(req, res) {
    // ── CORS ────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

    // ── 1. Verify session (cookie, Google OAuth via /api/auth) ──────────────
    const { admin, error: authErr } = await requireAdmin(req, 'kuliah');
    if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
    const actorEmail = admin.email;
    const actorName = admin.name || null;

    // ── 2. Parse month param ────────────────────────────────────────────────
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'Invalid month parameter — expected YYYY-MM' });
    }

    const [yearStr, monthStr] = month.split('-');
    const year     = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: 'Month out of range' });
    }

    // Only the real current/next month may ever be published — this keeps the
    // file's `months` map bounded to exactly these two keys (see prune step below).
    const { realCurrentKey, realNextKey } = computeRealMonthKeys(new Date(Date.now() + MYT_OFFSET_MS));
    if (month !== realCurrentKey && month !== realNextKey) {
        return res.status(400).json({
            error: `Month must be the real current (${realCurrentKey}) or next (${realNextKey}) month`,
        });
    }

    const startDate = `${month}-01`;
    const lastDay   = new Date(year, monthNum, 0).getDate();
    const endDate   = `${month}-${String(lastDay).padStart(2, '0')}`;

    // ── 3. Fetch ustaz + schedule from Neon ─────────────────────────────────
    let ustazList, scheduleRows;
    try {
        ustazList = await sql()`SELECT id, full_name, tajuk_kuliah, poster_url, square_url FROM ustaz`;
        scheduleRows = await sql()`SELECT date, cuti_umum, subuh_ustaz_id, maghrib_ustaz_id, subuh_pending, maghrib_pending, subuh_khas, maghrib_khas, subuh_ditangguhkan, maghrib_ditangguhkan FROM schedule WHERE date >= ${startDate} AND date <= ${endDate} ORDER BY date`;
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch data from Neon', details: e.message });
    }
    const ustazMap  = Object.fromEntries(ustazList.map(u => [u.id, u]));

    // ── 4. Build this month's entry ─────────────────────────────────────────
    const tajukBulan = `BULAN ${BULAN[monthNum - 1].toUpperCase()} ${year}`;
    const now        = new Date();
    const tarikhKemasKini =
        `*Dikemaskini oleh Biro Dakwah pada ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

    const senaraiHari = scheduleRows.map(row => {
        const subuhUstaz   = row.subuh_ustaz_id   ? ustazMap[row.subuh_ustaz_id]   : null;
        const maghribUstaz = row.maghrib_ustaz_id ? ustazMap[row.maghrib_ustaz_id] : null;
        return {
            date:      dateStr(row.date),
            subuh:     row.subuh_pending ? { pending: true, ...(row.subuh_khas ? { khas: true } : {}), ...(row.subuh_ditangguhkan ? { ditangguhkan: true } : {}) } : (subuhUstaz ? {
                nama_penceramah: subuhUstaz.full_name,
                tajuk_kuliah:    subuhUstaz.tajuk_kuliah || null,
                poster_url:      subuhUstaz.poster_url  || null,
                square_url:      subuhUstaz.square_url  || null,
                ...(row.subuh_khas ? { khas: true } : {}),
                ...(row.subuh_ditangguhkan ? { ditangguhkan: true } : {}),
            } : null),
            maghrib:   row.maghrib_pending ? { pending: true, ...(row.maghrib_khas ? { khas: true } : {}), ...(row.maghrib_ditangguhkan ? { ditangguhkan: true } : {}) } : (maghribUstaz ? {
                nama_penceramah: maghribUstaz.full_name,
                tajuk_kuliah:    maghribUstaz.tajuk_kuliah || null,
                poster_url:      maghribUstaz.poster_url  || null,
                square_url:      maghribUstaz.square_url  || null,
                ...(row.maghrib_khas ? { khas: true } : {}),
                ...(row.maghrib_ditangguhkan ? { ditangguhkan: true } : {}),
            } : null),
            cuti_umum: row.cuti_umum || null,
        };
    });

    // ── 5. Push to GitHub ────────────────────────────────────────────────────
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo  = process.env.GITHUB_REPO;  // e.g. "MAMTJ6/dev"
    if (!githubToken || !githubRepo) {
        return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });
    }

    const filePath  = 'kuliah/data/jadual_lengkap_v2.json';
    const ghHeaders = {
        'Authorization':        `Bearer ${githubToken}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
    };

    // Get current file content + SHA in one call (404 = new file, no SHA needed)
    const contentsRes = await fetch(
        `https://api.github.com/repos/${githubRepo}/contents/${filePath}`,
        { headers: ghHeaders }
    );
    if (!contentsRes.ok && contentsRes.status !== 404) {
        return res.status(500).json({
            error: 'Failed to read current file from GitHub',
            status: contentsRes.status,
        });
    }

    let currentSha;
    let monthsStore = {};
    if (contentsRes.ok) {
        const fileData = await contentsRes.json();
        currentSha  = fileData.sha;
        monthsStore = buildMonthsStoreFromExisting(fileData.content);
    }

    monthsStore = mergeAndPruneMonthsStore(
        monthsStore, month,
        { infoJadual: { tajukBulan, tarikhKemasKini }, senaraiHari },
        realCurrentKey, realNextKey
    );

    const jsonContent = JSON.stringify({ months: monthsStore }, null, 2);

    // Commit the new content (create if no SHA, update if SHA exists)
    const commitBody = {
        message: `[Admin] Terbitkan jadual ${tajukBulan}`,
        content: Buffer.from(jsonContent, 'utf8').toString('base64'),
        branch:  'main',
    };
    if (currentSha) commitBody.sha = currentSha;

    const updateRes = await fetch(
        `https://api.github.com/repos/${githubRepo}/contents/${filePath}`,
        {
            method:  'PUT',
            headers: ghHeaders,
            body:    JSON.stringify(commitBody),
        }
    );
    if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        return res.status(500).json({
            error:   'Failed to push to GitHub',
            details: errData.message || updateRes.statusText,
        });
    }

    const updateData = await updateRes.json();

    try {
        await sql()`INSERT INTO activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${actorEmail}, ${actorName}, 'publish', ${monthLabelFromKey(month)}, ${senaraiHari.length + ' hari diterbitkan.'})`;
    } catch (e) {
        console.error('activity_log insert failed:', e); // never blocks the publish response
    }

    return res.status(200).json({
        success:   true,
        commitUrl: updateData.commit?.html_url ?? null,
        published: { month, rows: senaraiHari.length, tajukBulan },
        months:    Object.keys(monthsStore),
    });
};

module.exports.computeRealMonthKeys        = computeRealMonthKeys;
module.exports.inferMonthKeyFromTajuk       = inferMonthKeyFromTajuk;
module.exports.buildMonthsStoreFromExisting = buildMonthsStoreFromExisting;
module.exports.mergeAndPruneMonthsStore     = mergeAndPruneMonthsStore;
module.exports.monthLabelFromKey            = monthLabelFromKey;

