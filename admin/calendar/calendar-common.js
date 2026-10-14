// ─────────────────────────────────────────────────────────────────────────────
// Shared across admin/calendar/*.js — permission gate + Terbitkan plumbing.
// Neon version (2026-10-14): cookie session (no Bearer), log via neonLog()
// to calendar_activity_log, last-published note via /api/kuliah reader.
// Requires /admin/kuliah/kuliah-api.js loaded first (shared generic helper).
// Same shape as admin/khutbah/khutbah-common.js.
// ─────────────────────────────────────────────────────────────────────────────

async function requireCalendarAccess() {
    return requireModuleAccess('kalendar');
}

// POST /api/publish-events with the full events array (cookie session).
// The endpoint validates, sorts, writes lastUpdated, pushes to GitHub, and
// logs to calendar_activity_log server-side.
async function publishCalendarEvents(events, btnId) {
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Menerbitkan...'; }
    try {
        const res = await fetch('/api/publish-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || json.error || `HTTP ${res.status}`);
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return null;
        }
        showToast('Berjaya diterbitkan.', 'success');
        neonLog('publish_calendar', `${events.length} acara`, json.lastUpdated || '', 'calendar_activity_log');
        return json;
    } catch (e) {
        console.error('publishCalendarEvents failed:', e);
        showToast(`Terbitan gagal: ${e.message}`, 'error');
        return null;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan & Terbitkan'; }
    }
}

async function loadLastPublishedCalendarNote(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
        const out = await kuliahApi('last-published', {
            params: { table: 'calendar_activity_log', logAction: 'publish_calendar' },
        });
        const row = out && out.row;
        if (!row) { el.textContent = 'Belum pernah diterbitkan.'; return; }
        el.textContent = `Terakhir diterbitkan: ${formatDateTimeMY(row.created_at)} — ${row.target_label || ''}`;
    } catch (e) {
        el.textContent = 'Belum pernah diterbitkan.';
    }
}
