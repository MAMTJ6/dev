// Vercel serverless function: news data layer + publisher on Neon.
// Replaces direct supabase-js calls from admin/news/*.js AND the old
// Supabase-REST publish flow. Single function (Hobby 12-function limit).
//
// Two branches, split by query param (same convention as api/staff-login.js):
//   ?action=...  — admin CRUD (cookie session via lib/db.js
//     requireAdmin(req,'news')): list/save/delete for announcements +
//     ticker, reorder-ticker batch, settings get/save.
//   ?target=...  — publish (POST, cookie session) or Vercel cron (GET,
//     CRON_SECRET Bearer, publishes BOTH targets, actor 'vercel-cron').
//
// Two publish targets, independently triggerable:
//   ?target=announcements → news/data/announcements.json  (our news/script.js
//                            resolves scheduling client-side, on the display's
//                            own clock — rows are published as-is, filtered
//                            only by `enabled`)
//   ?target=moving-text    → news/data/moving-text.json    (read DIRECTLY by
//                            Xibo's DataSet widget, no JS of ours runs there —
//                            scheduling MUST be resolved here, server-side,
//                            at publish time; see buildMovingTextJson())
//
// The khutbah fail-safe is the point of this file, not a detail of it —
// never interpolate an error/status string into a published line (see the
// old "ERROR: ... 503" ticker incident in news/newplan.md).
//
// Required Vercel environment variables:
//   NEON_DATABASE_URL, AUTH_SECRET, GITHUB_TOKEN, GITHUB_REPO, CRON_SECRET
//
// Neon version (2026-10-14): Supabase REST replaced with await sql().
// Pure scheduling/CSV builders still live in
// admin/news/publish-news-pure.js (zero Node dependency — also loaded as a
// plain <script> by the ticker preview panel).

const { sql, requireAdmin } = require('../lib/db');
const {
    parseCSVRow,
    looksLikeErrorText,
    mytDateString,
    mytDateTimeString,
    normalizeBoundary,
    isActiveNow,
    buildAnnouncementsJson,
    buildMovingTextJson,
} = require('../admin/news/publish-news-pure.js');

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia is UTC+8, no DST

const TARGETS = {
    announcements: { file: 'news/data/announcements.json', commitMessage: '[Admin] Terbitkan pengumuman',   action: 'publish_announcements' },
    'moving-text': { file: 'news/data/moving-text.json',   commitMessage: '[Admin] Terbitkan teks berjalan', action: 'publish_moving_text' },
};

const TARGET_LABELS = { announcements: 'Pengumuman', 'moving-text': 'Teks Berjalan' };

// news_settings keys the admin UI is allowed to write. The khutbah_last_*
// cache keys are server-written only (resolveKhutbahTitle below).
const WRITABLE_SETTINGS = new Set(['default_image', 'default_ticker_line', 'khutbah_csv_url']);

// Neon may return TIMESTAMP columns as Date objects, but every pure helper
// (normalizeBoundary/isActiveNow) and every consumer (admin inputs slice to
// 16 chars, news/script.js parseLocalDate) works on wall-time strings —
// String(Date) would be "Wed Oct 14 ..." garbage. Normalize at the boundary:
// Date → UTC ISO (tz-less TIMESTAMPs round-trip byte-identical on a UTC
// server), strings pass through truncated to YYYY-MM-DDTHH:MM, bare dates
// untouched so the full-day expansion still applies downstream.
function tsStr(v) {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 16);
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s.slice(0, 16);
}

function normNewsRow(r) {
    return { ...r, start_at: tsStr(r.start_at), end_at: tsStr(r.end_at) };
}

// ── Non-pure helpers (network I/O — not exported, same split as
// api/publish-infaq.js's pushJsonToGitHub) ──────────────────────────────────

async function fetchKhutbahTitle(csvUrl) {
    if (!csvUrl) return null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let res;
        try {
            res = await fetch(csvUrl, { signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }
        if (!res.ok) return null;

        const text = await res.text();
        const rows = text.split('\n').filter(line => line.length > 0).map(parseCSVRow);
        if (rows.length <= 1) return null; // header only, or genuinely empty

        const title = (rows[1][1] || '').trim();
        if (!title || looksLikeErrorText(title)) return null;
        return title;
    } catch (e) {
        return null; // network error, timeout/abort, malformed response — all fail the same way: fall back
    }
}

// Fail-safe khutbah resolution: on ANY failure falls back to the last
// known-good title cached in news_settings.khutbah_last_title instead of
// ever publishing the failure itself. On success, also writes the new title
// back to that cache so the NEXT failure has something to fall back to.
// Returns null only when there is truly nothing usable, current or cached —
// buildMovingTextJson then omits the khutbah row entirely.
async function resolveKhutbahTitle(csvUrl, lastGoodTitle) {
    const fresh = await fetchKhutbahTitle(csvUrl);
    if (!fresh) return lastGoodTitle || null;

    try {
        const nowIso = new Date().toISOString();
        await sql()`UPDATE news_settings SET value = ${fresh}, updated_at = ${nowIso} WHERE key = 'khutbah_last_title'`;
        await sql()`UPDATE news_settings SET value = ${nowIso}, updated_at = ${nowIso} WHERE key = 'khutbah_last_fetched_at'`;
    } catch (e) {
        console.error('news_settings khutbah cache write failed:', e); // never blocks the publish
    }
    return fresh;
}

// GET-sha-then-PUT against the GitHub Contents API, same pattern as
// api/publish.js / api/publish-infaq.js — but skips the PUT entirely (and
// returns { unchanged: true }) when the new content is byte-identical to
// what's already committed. Without this, the daily cron manufactures a
// commit every single day regardless of whether anything actually changed.
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
        if (existingContent.trim() === newContent.trim()) {
            return { unchanged: true };
        }
    }

    const commitBody = {
        message: commitMessage,
        content: Buffer.from(newContent, 'utf8').toString('base64'),
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
    return await putRes.json();
}

async function publishOneTarget(target, ctx) {
    const { ghHeaders, githubRepo, settings, mytNow, actorEmail, actorName } = ctx;
    const { file, commitMessage, action } = TARGETS[target];

    let jsonOut, activityDetail;

    if (target === 'announcements') {
        let rows;
        try {
            rows = await sql()`SELECT id, title, heading, body_text, image_url, start_at, end_at, enabled, sort_order FROM news_announcements`;
        } catch (e) {
            throw new Error(`Failed to fetch news_announcements: ${e.message}`);
        }
        jsonOut = buildAnnouncementsJson(rows.map(normNewsRow), settings);
        activityDetail = `${jsonOut.announcements.length} pengumuman diterbitkan`;
    } else {
        let rows;
        try {
            rows = await sql()`SELECT id, message, kind, prefix, start_at, end_at, enabled, sort_order FROM news_ticker`;
        } catch (e) {
            throw new Error(`Failed to fetch news_ticker: ${e.message}`);
        }
        const norm = rows.map(normNewsRow);

        // Only bother fetching the khutbah CSV if a khutbah row could
        // actually be active — the common case (no khutbah row, or it's
        // disabled) shouldn't pay for a network round-trip it won't use.
        let khutbahTitle = null;
        if (norm.some(r => r.kind === 'khutbah' && isActiveNow(r, mytNow))) {
            khutbahTitle = await resolveKhutbahTitle(settings.khutbah_csv_url, settings.khutbah_last_title);
        }

        jsonOut = buildMovingTextJson(norm, settings, khutbahTitle, mytNow);
        activityDetail = `${jsonOut['moving-text'].length} baris teks berjalan diterbitkan`;
    }

    const commit = await pushJsonToGitHubIfChanged(ghHeaders, githubRepo, file, jsonOut, commitMessage);

    // Activity log write never blocks the publish response.
    try {
        await sql()`INSERT INTO news_activity_log (actor_email, actor_name, action, target_label, detail) VALUES (${actorEmail || 'unknown'}, ${actorName}, ${action}, ${TARGET_LABELS[target]}, ${commit.unchanged ? activityDetail + ' (tiada perubahan)' : activityDetail})`;
    } catch (e) {
        console.error('news_activity_log insert failed:', e);
    }

    return { success: true, target, unchanged: !!commit.unchanged, commitUrl: commit.commit?.html_url ?? null };
}

// ─── Admin CRUD (?action=...) ────────────────────────────────────────────────
async function handleAdmin(req, res) {
    const action = String(req.query.action || '');
    const { error: authErr } = await requireAdmin(req, 'news');
    if (authErr) return res.status(authErr).json({ error: 'unauthorized' });

    try {
        // ── Reads ──
        if (req.method === 'GET' && action === 'list-announcements') {
            const rows = await sql()`SELECT id, title, heading, body_text, image_url, start_at, end_at, enabled, sort_order, created_at, updated_at FROM news_announcements ORDER BY sort_order ASC`;
            return res.status(200).json({ rows: rows.map(normNewsRow) });
        }
        if (req.method === 'GET' && action === 'list-ticker') {
            const rows = await sql()`SELECT id, message, kind, prefix, start_at, end_at, enabled, sort_order, created_at, updated_at FROM news_ticker ORDER BY sort_order ASC`;
            return res.status(200).json({ rows: rows.map(normNewsRow) });
        }
        if (req.method === 'GET' && action === 'get-settings') {
            const keys = String(req.query.keys || 'default_image,default_ticker_line,khutbah_last_title,khutbah_last_fetched_at').split(',').map(s => s.trim()).filter(Boolean);
            const rows = keys.length
                ? await sql()`SELECT key, value FROM news_settings WHERE key = ANY(${keys})`
                : await sql()`SELECT key, value FROM news_settings`;
            const out = {};
            rows.forEach(r => { out[r.key] = r.value; });
            return res.status(200).json({ settings: out });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const b = req.body || {};

        // ── Announcements save (insert when no id, update when id) ──
        if (action === 'save-announcement') {
            const r = b.row || {};
            if (!r.title || !String(r.title).trim()) return res.status(400).json({ error: 'title required' });
            const row = {
                title: String(r.title).trim(),
                heading: r.heading ? String(r.heading).trim() || null : null,
                body_text: r.body_text ? String(r.body_text) || null : null,
                image_url: r.image_url || null,
                start_at: r.start_at || null,
                end_at: r.end_at || null,
                enabled: r.enabled !== false,
                sort_order: Number.isFinite(+r.sort_order) ? +r.sort_order : 0,
            };
            if (!row.image_url && !row.body_text) {
                return res.status(400).json({ error: 'image_url or body_text required' });
            }
            if (r.id) {
                await sql()`UPDATE news_announcements SET title = ${row.title}, heading = ${row.heading}, body_text = ${row.body_text}, image_url = ${row.image_url}, start_at = ${row.start_at}, end_at = ${row.end_at}, enabled = ${row.enabled}, sort_order = ${row.sort_order}, updated_at = NOW() WHERE id = ${r.id}`;
            } else {
                await sql()`INSERT INTO news_announcements (title, heading, body_text, image_url, start_at, end_at, enabled, sort_order) VALUES (${row.title}, ${row.heading}, ${row.body_text}, ${row.image_url}, ${row.start_at}, ${row.end_at}, ${row.enabled}, ${row.sort_order})`;
            }
            return res.status(200).json({ ok: true });
        }
        if (action === 'delete-announcement') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM news_announcements WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }

        // ── Ticker save ──
        if (action === 'save-ticker') {
            const r = b.row || {};
            const kind = r.kind === 'khutbah' ? 'khutbah' : 'static';
            const row = {
                kind,
                message: kind === 'static' ? (r.message || null) : null,
                prefix: kind === 'khutbah' ? (r.prefix || null) : null,
                start_at: r.start_at || null,
                end_at: r.end_at || null,
                enabled: r.enabled !== false,
                sort_order: Number.isFinite(+r.sort_order) ? +r.sort_order : 0,
            };
            if (kind === 'static' && !row.message) return res.status(400).json({ error: 'message required' });
            if (r.id) {
                await sql()`UPDATE news_ticker SET kind = ${row.kind}, message = ${row.message}, prefix = ${row.prefix}, start_at = ${row.start_at}, end_at = ${row.end_at}, enabled = ${row.enabled}, sort_order = ${row.sort_order}, updated_at = NOW() WHERE id = ${r.id}`;
            } else {
                await sql()`INSERT INTO news_ticker (kind, message, prefix, start_at, end_at, enabled, sort_order) VALUES (${row.kind}, ${row.message}, ${row.prefix}, ${row.start_at}, ${row.end_at}, ${row.enabled}, ${row.sort_order})`;
            }
            return res.status(200).json({ ok: true });
        }
        if (action === 'delete-ticker') {
            if (!b.id) return res.status(400).json({ error: 'missing id' });
            await sql()`DELETE FROM news_ticker WHERE id = ${b.id}`;
            return res.status(200).json({ ok: true });
        }
        // ── Ticker reorder batch (drag-drop + ↑/↓ swap, one call) ──
        if (action === 'reorder-ticker') {
            const rows = Array.isArray(b.rows) ? b.rows : [];
            if (!rows.length) return res.status(400).json({ error: 'empty' });
            for (const r of rows) {
                if (!r.id || !Number.isFinite(+r.sort_order)) return res.status(400).json({ error: 'bad rows' });
            }
            for (const r of rows) {
                await sql()`UPDATE news_ticker SET sort_order = ${+r.sort_order}, updated_at = NOW() WHERE id = ${r.id}`;
            }
            return res.status(200).json({ ok: true, count: rows.length });
        }

        // ── Settings save ──
        if (action === 'save-setting') {
            if (!WRITABLE_SETTINGS.has(String(b.key))) return res.status(400).json({ error: 'bad key' });
            await sql()`UPDATE news_settings SET value = ${String(b.value ?? '')}, updated_at = NOW() WHERE key = ${String(b.key)}`;
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error('/api/publish-news admin failed:', e);
        return res.status(500).json({ error: 'server error', details: e.message });
    }
}

async function handler(req, res) {
    // ── CORS ────────────────────────────────────────────────────────────────
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

    const githubToken  = process.env.GITHUB_TOKEN;
    const githubRepo   = process.env.GITHUB_REPO;
    if (!githubToken || !githubRepo) {
        return res.status(500).json({ error: 'Server misconfiguration: missing GitHub env vars' });
    }

    let targets, actorEmail, actorName = null;

    if (req.method === 'GET') {
        // Vercel cron path (see vercel.json) — publishes BOTH targets in one
        // request. Fail closed: a missing CRON_SECRET must never be silently
        // equivalent to "no auth required".
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
            return res.status(500).json({ error: 'Server misconfiguration: CRON_SECRET not set' });
        }
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Invalid cron credentials' });
        }
        targets = Object.keys(TARGETS);
        actorEmail = 'vercel-cron';
    } else {
        const target = req.query.target;
        if (!TARGETS[target]) {
            return res.status(400).json({ error: 'Missing or invalid target — expected ?target=announcements|moving-text' });
        }
        // Cookie session (Google OAuth via /api/auth) — no Bearer JWT.
        const { admin, error: authErr } = await requireAdmin(req, 'news');
        if (authErr) return res.status(authErr).json({ error: 'Unauthorized' });
        actorEmail = admin.email;
        actorName = admin.name || null;
        targets = [target];
    }

    const ghHeaders = {
        'Authorization':        `Bearer ${githubToken}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
    };

    let settings = {};
    try {
        const rows = await sql()`SELECT key, value FROM news_settings`;
        rows.forEach(r => { settings[r.key] = r.value; });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch news_settings from Neon', details: e.message });
    }

    const mytNow = new Date(Date.now() + MYT_OFFSET_MS);
    const ctx = { ghHeaders, githubRepo, settings, mytNow, actorEmail, actorName };

    const results = {};
    for (const target of targets) {
        try {
            results[target] = await publishOneTarget(target, ctx);
        } catch (e) {
            results[target] = { success: false, target, error: e.message };
        }
    }

    if (targets.length === 1) {
        const only = results[targets[0]];
        return res.status(only.success ? 200 : 500).json(only);
    }

    const anyFailed = Object.values(results).some(r => !r.success);
    return res.status(anyFailed ? 500 : 200).json({ success: !anyFailed, results });
}

// module.exports itself is the request handler, with the pure builders
// re-exported as properties (same convention as api/publish.js /
// api/publish-infaq.js) — tests/publish-news.test.js imports them from here.
module.exports = handler;
module.exports.parseCSVRow            = parseCSVRow;
module.exports.looksLikeErrorText     = looksLikeErrorText;
module.exports.mytDateString          = mytDateString;
module.exports.mytDateTimeString      = mytDateTimeString;
module.exports.normalizeBoundary      = normalizeBoundary;
module.exports.isActiveNow            = isActiveNow;
module.exports.buildAnnouncementsJson = buildAnnouncementsJson;
module.exports.buildMovingTextJson    = buildMovingTextJson;
