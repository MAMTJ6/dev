let logLimit = 50;
const LOG_PAGE_SIZE = 50;

let filterAdmin  = '';
let filterAction = '';
let filterFrom   = '';
let filterTo     = '';

// One entry per module's own activity_log table — add a module here (table +
// its own action-label map) to bring a future module's log into this page,
// nothing else needs to change. Mirrors the MODULES config pattern in app.js.
const LOG_SOURCES = [
    {
        module: 'Kuliah', table: 'activity_log',
        actionLabels: {
            schedule_day_edit:  'Edit Jadual Harian',
            schedule_duplicate: 'Salin Data Bulan',
            schedule_clear:     'Kosongkan Bulan',
            ustaz_create:       'Tambah Penceramah',
            ustaz_update:       'Kemaskini Penceramah',
            ustaz_delete:       'Padam Penceramah',
            admin_create:       'Tambah Pengguna',
            admin_update:       'Kemaskini Pengguna',
            admin_delete:       'Buang Pengguna',
            publish:            'Terbitkan Jadual',
            publish_ustaz:      'Terbitkan Penceramah',
        },
    },
    {
        module: 'Infaq', table: 'infaq_activity_log',
        actionLabels: {
            infaq_kutipan_mingguan_create: 'Tambah Kutipan Mingguan',
            infaq_kutipan_mingguan_update: 'Kemaskini Kutipan Mingguan',
            infaq_kutipan_mingguan_delete: 'Padam Kutipan Mingguan',
            infaq_perbelanjaan_create:     'Tambah Perbelanjaan',
            infaq_perbelanjaan_update:     'Kemaskini Perbelanjaan',
            infaq_perbelanjaan_delete:     'Padam Perbelanjaan',
            infaq_projek_kutipan_create:   'Tambah Kutipan Projek',
            infaq_projek_kutipan_update:   'Kemaskini Kutipan Projek',
            infaq_projek_kutipan_delete:   'Padam Kutipan Projek',
            infaq_project_create:          'Tambah Projek',
            infaq_project_update:          'Kemaskini Projek',
            infaq_project_activate:        'Aktifkan Projek',
            infaq_project_delete:          'Padam Projek',
            publish_monthly:               'Terbitkan Kutipan Mingguan',
            publish_daily:                 'Terbitkan Kutipan Projek',
            publish_perbelanjaan:          'Terbitkan Perbelanjaan',
            publish_project:               'Terbitkan Projek',
        },
    },
    {
        module: 'Pengumuman', table: 'news_activity_log',
        actionLabels: {
            news_announcement_create: 'Tambah Pengumuman',
            news_announcement_update: 'Kemaskini Pengumuman',
            news_announcement_delete: 'Padam Pengumuman',
            news_ticker_create:       'Tambah Baris Teks Berjalan',
            news_ticker_update:       'Kemaskini Baris Teks Berjalan',
            news_ticker_delete:       'Padam Baris Teks Berjalan',
            news_ticker_reorder:      'Susun Semula Teks Berjalan',
            news_settings_update:     'Kemaskini Tetapan Pengumuman',
            publish_announcements:    'Terbitkan Pengumuman',
            publish_moving_text:      'Terbitkan Teks Berjalan',
        },
    },
    {
        module: 'Staf', table: 'staff_activity_log',
        actionLabels: {
            staff_create:          'Tambah Staf',
            staff_update:          'Kemaskini Staf',
            staff_delete:          'Padam Staf',
            staff_pin_reset:       'Jana Semula PIN',
            staff_lockout_cleared: 'Buka Kunci Akaun',
        },
    },
    {
        module: 'Khutbah', table: 'khutbah_activity_log',
        actionLabels: {
            khutbah_auto_generate:  'Janaan Automatik',
            khutbah_scrape_ok:      'Scrape Berjaya',
            khutbah_scrape_failed:  'Scrape Gagal',
            khutbah_manual_update:  'Kemaskini Manual',
            khutbah_lock:           'Kunci Minggu',
            khutbah_unlock:         'Buka Kunci Minggu',
            khutbah_settings_update:'Kemaskini Tetapan Khutbah',
            publish_khutbah:        'Terbitkan Khutbah',
        },
    },
    {
        module: 'Kalendar', table: 'calendar_activity_log',
        actionLabels: {
            publish_calendar: 'Terbitkan Kalendar',
        },
    },
];

(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (currentAdmin.role !== 'super_admin') {
        showToast('Akses ditolak. Halaman ini hanya untuk Super Admin.', 'error');
        setTimeout(() => window.location.replace(defaultLandingPageFor(currentAdmin) || '/admin/index.html'), 2000);
        return;
    }
    await Promise.all([populateFilterOptions(), loadLog()]);
})();

async function populateFilterOptions() {
    const actionSelect = document.getElementById('filter-action');
    actionSelect.innerHTML = '<option value="">Semua Tindakan</option>' +
        LOG_SOURCES.map(source => `
            <optgroup label="${escapeHtml(source.module)}">
                ${Object.entries(source.actionLabels).map(([value, label]) =>
                    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
                ).join('')}
            </optgroup>
        `).join('');

    let users = [];
    try {
        users = (await authApi('users')).users || [];
    } catch (e) { /* filter dropdown just stays admin-less; not worth blocking the page over */ }
    const adminSelect = document.getElementById('filter-admin');
    adminSelect.innerHTML = '<option value="">Semua Admin</option>' +
        users.map(u =>
            `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name || u.email)}</option>`
        ).join('');
}

function applyFilters() {
    filterAdmin  = document.getElementById('filter-admin').value;
    filterAction = document.getElementById('filter-action').value;
    filterFrom   = document.getElementById('filter-from').value;
    filterTo     = document.getElementById('filter-to').value;
    logLimit = LOG_PAGE_SIZE;
    loadLog();
}

function resetFilters() {
    document.getElementById('filter-admin').value  = '';
    document.getElementById('filter-action').value = '';
    document.getElementById('filter-from').value   = '';
    document.getElementById('filter-to').value     = '';
    applyFilters();
}

// Fetches each module's log table independently (each capped at logLimit —
// enough to guarantee the true merged top-`logLimit` rows are among them,
// since a global top-N can never need more than N rows from any one source),
// tags every row with which module/label-map it came from, then merges and
// re-sorts by created_at so kuliah and infaq events interleave into one real
// timeline instead of two separate lists. A source that errors degrades to
// an empty list rather than blanking the whole page — same instinct as
// populateFilterOptions()'s admin-dropdown fallback above.
async function loadLog() {
    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Memuatkan...</td></tr>';

    const results = await Promise.all(LOG_SOURCES.map(async (source) => {
        const params = { table: source.table, limit: logLimit };
        if (filterAdmin)  params.actor = filterAdmin;
        if (filterAction) params.logAction = filterAction;
        if (filterFrom)   params.from = new Date(filterFrom + 'T00:00:00').toISOString();
        if (filterTo)     params.to = new Date(filterTo + 'T23:59:59').toISOString();

        let rows;
        try {
            rows = (await authApi('logs', { params })).rows || [];
        } catch (e) {
            console.error(`Gagal memuatkan log ${source.module}:`, e.message);
            return [];
        }
        return rows.map(row => ({ ...row, _module: source.module, _actionLabels: source.actionLabels }));
    }));

    const merged = results
        .flat()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, logLimit);

    renderLog(merged);
    document.getElementById('load-more-log-btn').style.display =
        results.some(rows => rows.length >= logLimit) ? '' : 'none';
}

function renderLog(rows) {
    const tbody = document.getElementById('log-tbody');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada aktiviti direkod.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td data-label="Masa">${escapeHtml(formatDateTimeMY(r.created_at))}</td>
            <td data-label="Modul"><span class="log-module-badge log-module-${r._module.toLowerCase()}">${escapeHtml(r._module)}</span></td>
            <td data-label="Admin">${escapeHtml(r.actor_name || r.actor_email)}</td>
            <td data-label="Tindakan">${escapeHtml(r._actionLabels[r.action] || r.action)}</td>
            <td data-label="Sasaran">${escapeHtml(r.target_label || '—')}</td>
            <td data-label="Butiran" style="color:var(--text-muted);font-size:0.8125rem">${escapeHtml(r.detail || '—')}</td>
        </tr>
    `).join('');
}

function loadMoreLog() {
    logLimit += LOG_PAGE_SIZE;
    loadLog();
}
