// ─────────────────────────────────────────────────────────────────────────────
// Shared across every admin/news/*.js page — permission gate, Terbitkan
// plumbing, settings helpers, and the status computation both pages' tables
// use. Loaded after app.js (+ kuliah-api.js for requireKuliahAuth/neonLog)
// and before each page's own script, same shape as admin/infaq/infaq-common.js.
// Neon version (2026-10-14): settings + publish + last-published note all go
// through /api/publish-news (cookie session) — no Supabase client, no Bearer.
// ─────────────────────────────────────────────────────────────────────────────

// Every news page calls this right after requireKuliahAuth(), e.g.:
//   const session = await requireKuliahAuth();
//   if (!session) return;
//   if (!(await requireNewsAccess())) return;
// Thin wrapper around app.js's generic requireModuleAccess() — same pattern
// as infaq-common.js's requireInfaqAccess().
async function requireNewsAccess() {
    return requireModuleAccess('news');
}

// Admin news API (Neon, via /api/publish-news?action=... cookie session).
// Mirrors kuliahApi() in /admin/kuliah/kuliah-api.js for this endpoint.
async function newsApi(action, { method = 'GET', params = {}, body = null } = {}) {
    const q = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`/api/publish-news?${q}`, {
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

// ─── Status computation (pengumuman.js + teks-berjalan.js tables) ──────────────
// Four states, purely date/enabled-derived — never stored, always computed
// fresh from the row so the admin table and the published JSON's own
// filtering (news/script.js's isActive() for announcements, api/publish-news.js's
// isActiveNow() for the ticker) can never silently disagree about what
// "active" means. `now` defaults to the browser's own clock; callers can
// pass a fixed Date for the ticker preview panel so every row in one preview
// render is judged against the exact same instant.
const NEWS_STATUS_CLASS = {
    'Aktif':       'news-status-active',
    'Akan Datang': 'news-status-upcoming',
    'Tamat':       'news-status-expired',
    'Dimatikan':   'news-status-off',
};

// Row-action icons — global ACTION_ICONS (admin/app.js) holds edit/delete;
// this alias adds the news-only duplicate icon so both pages keep one import.
const NEWS_ACTION_ICONS = {
    edit: ACTION_ICONS.edit,
    duplicate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    delete: ACTION_ICONS.delete,
};

function localDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Minute-precision counterpart of localDateString, for start_at/end_at now
// that they carry day+hour+minute (see setup.sql §10's TIMESTAMP migration).
// Reads the browser's own local clock — fine for a glance-status label,
// deliberately separate from publish-news-pure.js's MYT-shifted
// mytDateTimeString() (which pengumuman.html doesn't even load), so this
// file works standalone on either admin page.
function localDateTimeString(d) {
    return `${localDateString(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Same "bare date expands to the full day" idea as
// publish-news-pure.js's normalizeBoundary() — kept as its own small copy
// here rather than a shared import, since news-common.js has to work on
// pengumuman.html too, which never loads publish-news-pure.js.
function normalizeBoundaryLocal(value, isEnd) {
    if (!value) return null;
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str + (isEnd ? 'T23:59' : 'T00:00');
    return str.slice(0, 16);
}

function computeStatus(row, now = new Date()) {
    if (row.enabled === false) return 'Dimatikan';
    const nowStr = localDateTimeString(now);
    const start = normalizeBoundaryLocal(row.start_at, false);
    const end   = normalizeBoundaryLocal(row.end_at, true);
    if (start && nowStr < start) return 'Akan Datang';
    if (end && nowStr > end) return 'Tamat';
    return 'Aktif';
}

function statusBadgeHtml(status) {
    return `<span class="news-status-badge ${NEWS_STATUS_CLASS[status] || ''}">${escapeHtml(status)}</span>`;
}

// ─── Settings (news_settings key/value table, via /api/publish-news) ───────────
// Reads are open to any admin with the news module (server enforces the same
// 'news' permission for reads and writes — simpler than the old split, and
// both news pages already sit behind requireNewsAccess anyway).
async function getSetting(key, fallback = '') {
    try {
        const out = await newsApi('get-settings', { params: { keys: key } });
        return (out.settings && out.settings[key]) ?? fallback;
    } catch (e) {
        return fallback;
    }
}

async function getSettings(keys) {
    try {
        const out = await newsApi('get-settings', { params: { keys: (keys || []).join(',') } });
        return (out && out.settings) || {};
    } catch (e) {
        return {};
    }
}

async function saveSetting(key, value) {
    return newsApi('save-setting', { method: 'POST', body: { key, value } });
}

// ─── Character counter (shows remaining chars once near the limit) ────────────
// Wired to a text input/textarea + a small note element; the note only
// becomes visible once length reaches ~80% of the limit, so a normal-length
// entry never shows a permanent counter. Returns the update function so the
// caller can also re-run it right after setting .value programmatically
// (openAddModal/openEditModal) — a JS-set value doesn't fire 'input'.
function attachCharCounter(inputId, counterId, limit, thresholdRatio = 0.8) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (!input || !counter) return () => {};

    const update = () => {
        const remaining = limit - input.value.length;
        if (input.value.length >= limit * thresholdRatio) {
            counter.textContent = remaining >= 0
                ? `${remaining} aksara lagi`
                : `${-remaining} aksara melebihi had`;
            counter.style.display = '';
        } else {
            counter.style.display = 'none';
        }
    };

    input.addEventListener('input', update);
    update();
    return update;
}

// ─── Publish (shared by pengumuman.js / teks-berjalan.js) ──────────────────────
// Each of the 2 news data pages owns its own Terbitkan button, right next to
// the data it publishes — same reasoning/shape as infaq's 3-target split
// (admin/CLAUDE.md's Key Patterns). api/publish-news.js's TARGETS keys are
// 'announcements' and 'moving-text'. Cookie session — no Bearer header.
const PUBLISH_BUTTON_LABELS = {
    'publish-announcements-btn': 'Terbitkan',
    'publish-ticker-btn':        'Terbitkan',
};

const PUBLISH_NOTE_TARGETS = {
    'announcements': ['publish_announcements', 'last-published-announcements'],
    'moving-text':   ['publish_moving_text',   'last-published-ticker'],
};

async function loadLastPublishedNewsNote(action, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
        const out = await kuliahApi('last-published', {
            params: { table: 'news_activity_log', logAction: action },
        });
        const row = out && out.row;
        if (!row) {
            el.textContent = 'Belum pernah diterbitkan.';
        } else {
            const who = row.actor_name || row.actor_email;
            el.textContent = `Terakhir diterbitkan pada ${formatDateTimeMY(row.created_at)} (${formatRelativeMY(row.created_at)}) oleh ${who}`;
        }
    } catch (e) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'block';
}

async function publishNews(target, btnId) {
    const btn = document.getElementById(btnId);
    const originalLabel = PUBLISH_BUTTON_LABELS[btnId];
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Menerbitkan...';

    try {
        const res = await fetch(`/api/publish-news?target=${target}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return;
        }

        if (!res.ok) {
            const detail = data.details ? ` (${data.details})` : '';
            showToast('Gagal menerbitkan: ' + (data.error || res.statusText) + detail, 'error', 8000);
        } else if (data.unchanged) {
            showToast('Tiada perubahan — tidak perlu diterbitkan semula.', 'info', 5000);
            const [action, elId] = PUBLISH_NOTE_TARGETS[target];
            await loadLastPublishedNewsNote(action, elId);
        } else {
            showToast('Berjaya diterbitkan!', 'success', 6000);
            const [action, elId] = PUBLISH_NOTE_TARGETS[target];
            await loadLastPublishedNewsNote(action, elId);
        }
    } catch (err) {
        showToast('Ralat sambungan: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = originalLabel;
}
