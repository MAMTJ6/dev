// ─────────────────────────────────────────────────────────────────────────────
// Shared across every admin/khutbah/*.js page — permission gate, Terbitkan
// plumbing, and settings helpers. Loaded after app.js (+ kuliah-api.js for
// requireKuliahAuth/neonLog) and before each page's own script, same shape as
// admin/news/news-common.js and admin/infaq/infaq-common.js.
// Neon version (2026-10-14): settings + weeks + publish + last-published note
// all go through /api/publish-khutbah (cookie session) — no Supabase client,
// no Bearer.
// ─────────────────────────────────────────────────────────────────────────────

async function requireKhutbahAccess() {
    return requireModuleAccess('khutbah');
}

// Admin khutbah API (Neon, via /api/publish-khutbah?action=... cookie session).
// Mirrors kuliahApi() in /admin/kuliah/kuliah-api.js for this endpoint.
async function khutbahApi(action, { method = 'GET', params = {}, body = null } = {}) {
    const q = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`/api/publish-khutbah?${q}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : null,
    });
    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }
    if (!res.ok) {
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            throw new Error('sesi tamat');
        }
        throw new Error((data && data.error) || res.statusText);
    }
    return data;
}

// ─── Settings (khutbah_settings key/value table, via /api/publish-khutbah) ────
// Reads are open to any admin with the khutbah module (server enforces the
// same 'khutbah' permission for reads and writes — both khutbah pages already
// sit behind requireKhutbahAccess anyway).

async function getKhutbahSetting(key, fallback = '') {
    try {
        const out = await khutbahApi('get-settings', { params: { keys: key } });
        return (out.settings && out.settings[key]) ?? fallback;
    } catch (e) {
        return fallback;
    }
}

async function getKhutbahSettings(keys) {
    try {
        const out = await khutbahApi('get-settings', { params: { keys: (keys || []).join(',') } });
        return (out && out.settings) || {};
    } catch (e) {
        return {};
    }
}

async function saveKhutbahSetting(key, value) {
    return khutbahApi('save-setting', { method: 'POST', body: { key, value } });
}

// ─── Publish ─────────────────────────────────────────────────────────────────
// Single target (unlike news/infaq splits): POST /api/publish-khutbah (cookie
// session). The Mon-9am Vercel cron hits the same endpoint with GET +
// CRON_SECRET instead — see api/publish-khutbah.js.
async function publishKhutbah(btnId) {
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Menerbitkan...'; }
    try {
        const res = await fetch('/api/publish-khutbah', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return null;
        }
        if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
        showToast(json.unchanged ? 'Diterbitkan (tiada perubahan).' : 'Berjaya diterbitkan.', 'success');
        neonLog('publish_khutbah', json.friday_date || '', json.title || '', 'khutbah_activity_log');
        return json;
    } catch (e) {
        console.error('publishKhutbah failed:', e);
        showToast(`Terbitan gagal: ${e.message}`, 'error');
        return null;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Jana & Terbitkan'; }
    }
}

async function loadLastPublishedKhutbahNote(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
        const out = await kuliahApi('last-published', {
            params: { table: 'khutbah_activity_log', logAction: 'publish_khutbah' },
        });
        const row = out && out.row;
        if (!row) { el.textContent = 'Belum pernah diterbitkan.'; return; }
        el.textContent = `Terakhir diterbitkan: ${row.target_label || ''} — ${formatDateTimeMY(row.created_at)}`;
    } catch (e) {
        el.textContent = 'Belum pernah diterbitkan.';
    }
}
