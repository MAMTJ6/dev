// ─────────────────────────────────────────────────────────────────────────────
// Shared across every admin/infaq/*.js page — permission gate + small
// formatters/helpers, loaded after app.js (+ kuliah-api.js for
// requireKuliahAuth/neonLog) and before each page's own script.
// Neon version (2026-10-14): CRUD + publish + last-published notes all go
// through /api/publish-infaq (cookie session) — no Supabase client, no Bearer.
// ─────────────────────────────────────────────────────────────────────────────

const BULAN_MY = [
    'Januari','Februari','Mac','April','Mei','Jun',
    'Julai','Ogos','September','Oktober','November','Disember'
];

function formatRM(amount) {
    return 'RM ' + Number(amount || 0).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Every infaq page calls this right after requireKuliahAuth(), e.g.:
//   const session = await requireKuliahAuth();
//   if (!session) return;
//   if (!(await requireInfaqAccess())) return;
// Thin wrapper around app.js's generic requireModuleAccess() (added when the
// same gate was extended to kuliah) — kept as its own name since every infaq
// page's call site already reads requireInfaqAccess().
async function requireInfaqAccess() {
    return requireModuleAccess('infaq');
}

// Admin infaq API (Neon, via /api/publish-infaq?action=... cookie session).
// Mirrors kuliahApi() in /admin/kuliah/kuliah-api.js for this endpoint.
async function infaqApi(action, { method = 'GET', params = {}, body = null } = {}) {
    const q = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`/api/publish-infaq?${q}`, {
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
        const err = new Error((data && data.error) || res.statusText);
        if (data && data.count !== undefined) err.count = data.count;
        throw err;
    }
    return data;
}

// ─── Publish (shared by kutipan.js / perbelanjaan.js / projek-kutipan.js) ──────
// Each of the 3 infaq data pages owns its own Terbitkan button, right next to
// the data it publishes (2026-07-22) — ringkasan.html used to host all three
// centrally, moved here so editing and publishing happen on the same screen.
// Every call site passes its own `target`/`btnId`, this stays generic.
// Cookie session — no Bearer header.
const PUBLISH_BUTTON_LABELS = {
    'publish-monthly-btn':      'Terbitkan',
    'publish-perbelanjaan-btn': 'Terbitkan',
    'publish-daily-btn':        'Terbitkan',
    'publish-project-btn':      'Terbitkan',
};

const PUBLISH_NOTE_TARGETS = {
    monthly:      ['publish_monthly', 'last-published-monthly'],
    perbelanjaan: ['publish_perbelanjaan', 'last-published-perbelanjaan'],
    daily:        ['publish_daily', 'last-published-daily'],
};

async function loadLastPublishedInfaqNote(action, elId, label) {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
        const out = await kuliahApi('last-published', {
            params: label
                ? { table: 'infaq_activity_log', logAction: action, label }
                : { table: 'infaq_activity_log', logAction: action },
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

async function publishInfaq(target, btnId) {
    const btn = document.getElementById(btnId);
    const originalLabel = PUBLISH_BUTTON_LABELS[btnId];
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Menerbitkan...';

    try {
        const res = await fetch(`/api/publish-infaq?target=${target}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return;
        }

        if (!res.ok) {
            const detail = data.details ? ` (${data.details})` : '';
            showToast('Gagal menerbitkan: ' + (data.error || res.statusText) + detail, 'error', 8000);
        } else {
            showToast('Berjaya diterbitkan!', 'success', 6000);
            const [action, elId] = PUBLISH_NOTE_TARGETS[target];
            await loadLastPublishedInfaqNote(action, elId);
        }
    } catch (err) {
        showToast('Ralat sambungan: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = originalLabel;
}

async function publishInfaqProject(projectId, btnId) {
    const btn = document.getElementById(btnId);
    const originalLabel = PUBLISH_BUTTON_LABELS[btnId];
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Menerbitkan...';

    try {
        const res = await fetch(`/api/publish-infaq?target=project&project=${encodeURIComponent(projectId)}`, {
            method: 'POST',
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return;
        }

        if (!res.ok) {
            const detail = data.details ? ` (${data.details})` : '';
            showToast('Gagal menerbitkan: ' + (data.error || res.statusText) + detail, 'error', 8000);
        } else {
            showToast('Berjaya diterbitkan!', 'success', 6000);
        }
    } catch (err) {
        showToast('Ralat sambungan: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = originalLabel;
}
