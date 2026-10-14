// admin/changelog.js — renders admin/changelog.json (the single maintained
// changelog: Malay ringkasan for committee admins, expandable technical
// detail for developers). Read-only page: any authenticated admin may view,
// no module permission gate. Before committing a user-visible change, append
// an entry to changelog.json (see root CLAUDE.md Key Patterns).

let allEntries = [];

(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    await loadChangelog();
})();

function formatDateMY(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return escapeHtml(iso || '');
    return d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadChangelog() {
    const list = document.getElementById('changelog-list');
    try {
        const res = await fetch('/admin/changelog.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Format tidak sah');
        allEntries = data.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } catch (e) {
        console.error('loadChangelog failed:', e);
        list.innerHTML = `<div class="card" style="padding:1rem 1.25rem"><p class="state-cell">Ralat memuatkan sejarah: ${escapeHtml(e.message)}</p></div>`;
        return;
    }
    fillModuleFilter();
    renderChangelog();
}

function fillModuleFilter() {
    const sel = document.getElementById('filter-module');
    const mods = [...new Set(allEntries.map(e => e.module).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Semua Modul</option>'
        + mods.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
}

function applyChangelogFilter() {
    renderChangelog();
}

function resetChangelogFilter() {
    document.getElementById('filter-module').value = '';
    renderChangelog();
}

function renderChangelog() {
    const list = document.getElementById('changelog-list');
    const mod = document.getElementById('filter-module').value;
    const rows = allEntries.filter(e => !mod || e.module === mod);
    if (!rows.length) {
        list.innerHTML = `<div class="card" style="padding:1rem 1.25rem"><p class="state-cell">Tiada catatan.</p></div>`;
        return;
    }
    list.innerHTML = rows.map(e => `
        <div class="card" style="padding:1rem 1.25rem;margin-bottom:0.75rem">
            <p class="subsection-title" style="margin:0 0 0.25rem">${escapeHtml(e.module || 'Umum')} — ${formatDateMY(e.date)}</p>
            <p style="font-size:0.875rem;margin:0 0 0.5rem">${escapeHtml(e.ringkasan || '')}</p>
            ${e.detail ? `<details><summary style="font-size:0.8125rem;color:var(--text-muted);cursor:pointer">Butiran teknikal</summary><p style="font-size:0.8125rem;color:var(--text-muted);margin:0.5rem 0 0;white-space:pre-wrap">${escapeHtml(e.detail)}</p></details>` : ''}
        </div>`).join('');
}
