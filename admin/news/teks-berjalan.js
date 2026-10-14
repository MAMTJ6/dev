// ─── State ────────────────────────────────────────────────────────────────────
let allTicker      = [];
let deletingTickerId = null;
let dragTickerId     = null;
let cachedSettings = {};
let updateMessageCounter = () => {};
let updatePrefixCounter  = () => {};

const TICKER_MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia is UTC+8, no DST — same constant as api/publish-news.js

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireNewsAccess())) return;

    const canWrite = canWriteModule('news');
    document.getElementById('add-ticker-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('publish-ticker-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('save-settings-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('setting-default-line').disabled = !canWrite;

    updateMessageCounter = attachCharCounter('edit-message', 'edit-message-counter', 74);
    updatePrefixCounter  = attachCharCounter('edit-prefix', 'edit-prefix-counter', 74);

    await Promise.all([
        loadTicker(),
        loadLastPublishedNewsNote('publish_moving_text', 'last-published-ticker'),
        loadTickerSettings(),
    ]);
    renderPreview();
})();

// ─── Load and render ──────────────────────────────────────────────────────────
async function loadTicker() {
    let out;
    try {
        out = await newsApi('list-ticker');
    } catch (e) {
        showToast('Gagal memuatkan teks berjalan: ' + e.message, 'error');
        return;
    }
    allTicker = out.rows || [];
    renderTable();
}

function tickerLineLabel(row) {
    if (row.kind === 'khutbah') {
        return `${row.prefix || ''}<span style="color:var(--text-muted)">{tajuk khutbah automatik}</span>`;
    }
    return escapeHtml(row.message || '');
}

function renderTable() {
    const tbody = document.getElementById('ticker-tbody');
    const canWrite = canWriteModule('news');

    if (!allTicker.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada baris lagi. Klik "+ Tambah Baris" untuk mula.</td></tr>';
        return;
    }

    tbody.innerHTML = allTicker.map((r, i) => `
        <tr ondragover="tickerDragOver(event)" ondragleave="tickerDragLeave(event)" ondrop="tickerDrop(event, '${escapeHtml(r.id)}')">
            <td data-label="Susun">
                ${canWrite ? `
                <div style="display:flex;gap:0.25rem;align-items:center">
                    <span class="ticker-grip" draggable="true" ondragstart="tickerDragStart(event, '${escapeHtml(r.id)}')" ondragend="tickerDragEnd(event)" title="Seret untuk susun">&#10022;</span>
                    <button class="btn btn-ghost btn-sm" title="Naik" onclick="moveTicker('${escapeHtml(r.id)}', -1)" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
                    <button class="btn btn-ghost btn-sm" title="Turun" onclick="moveTicker('${escapeHtml(r.id)}', 1)" ${i === allTicker.length - 1 ? 'disabled' : ''}>&darr;</button>
                </div>
                ` : (i + 1)}
            </td>
            <td data-label="Baris">${tickerLineLabel(r)}</td>
            <td data-label="Jenis">${r.kind === 'khutbah' ? '<span class="news-status-badge news-status-khutbah">Khutbah</span>' : 'Statik'}</td>
            <td data-label="Tempoh" style="font-size:0.8125rem">${tempohLabelTicker(r)}</td>
            <td data-label="Status">${statusBadgeHtml(computeStatus(r))}</td>
            <td data-label="">
                ${canWrite ? `
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(r.id)}')">${NEWS_ACTION_ICONS.edit}</button>
                    <button class="btn btn-ghost btn-sm" title="Duplicate" aria-label="Duplicate" onclick="duplicateTicker('${escapeHtml(r.id)}')">${NEWS_ACTION_ICONS.duplicate}</button>
                    <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(r.id)}', '${escapeHtml(r.kind === 'khutbah' ? (r.prefix || 'Khutbah') : (r.message || ''))}')">${NEWS_ACTION_ICONS.delete}</button>
                </div>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

// start_at/end_at are TIMESTAMP now (day+hour+minute) — a legacy bare-date
// value (YYYY-MM-DD, no time) still renders as just the date, same
// leniency the DB/isActiveNow side already has.
function fmtDateTimeShortTicker(value) {
    if (!value) return '';
    const str = String(value);
    const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(str);
    const d = new Date(isBareDate ? str + 'T00:00:00' : str);
    const datePart = `${d.getDate()} ${BULAN_MALAY[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
    if (isBareDate) return datePart;
    return `${datePart}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tempohLabelTicker(row) {
    if (!row.start_at && !row.end_at) return 'Sentiasa';
    if (row.start_at && row.end_at) return `${fmtDateTimeShortTicker(row.start_at)} — ${fmtDateTimeShortTicker(row.end_at)}`;
    if (row.start_at) return `Dari ${fmtDateTimeShortTicker(row.start_at)}`;
    return `Sehingga ${fmtDateTimeShortTicker(row.end_at)}`;
}

// ─── Reorder (↑/↓ swap sort_order with the adjacent row) ───────────────────────
async function moveTicker(id, direction) {
    const index = allTicker.findIndex(r => r.id === id);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= allTicker.length) return;

    const a = allTicker[index], b = allTicker[swapIndex];
    try {
        await newsApi('reorder-ticker', { method: 'POST', body: { rows: [
            { id: a.id, sort_order: b.sort_order },
            { id: b.id, sort_order: a.sort_order },
        ] } });
    } catch (e) {
        showToast('Gagal menyusun semula: ' + e.message, 'error');
        return;
    }
    await neonLog('news_ticker_reorder', tickerLabelPlain(a), 'Susunan baris diubah.', 'news_activity_log');
    await loadTicker();
    renderPreview();
}

// ─── Reorder via drag-and-drop (desktop) ──────────────────────────────────────
// Grip-only drag source so text selection and button clicks still work. Drop
// position (before/after) comes from pointer Y vs the target row's midpoint.
// After a drop the new order is re-pinned 0..n-1 and only rows whose
// sort_order actually changed are written — same "numbers must match the
// line" idea, minimal saves. Preview re-renders immediately; the published
// moving-text.json still follows only via Terbitkan (or cron).
function tickerDragStart(e, id) {
    dragTickerId = id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
    const tr = e.target.closest('tr');
    if (tr) tr.classList.add('ticker-dragging');
}

function clearTickerDropIndicators() {
    document.querySelectorAll('#ticker-tbody tr.ticker-drop-before, #ticker-tbody tr.ticker-drop-after')
        .forEach(tr => tr.classList.remove('ticker-drop-before', 'ticker-drop-after'));
}

function tickerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.currentTarget;
    const rect = tr.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    clearTickerDropIndicators();
    tr.classList.add(after ? 'ticker-drop-after' : 'ticker-drop-before');
}

function tickerDragLeave(e) {
    e.currentTarget.classList.remove('ticker-drop-before', 'ticker-drop-after');
}

function tickerDragEnd() {
    dragTickerId = null;
    clearTickerDropIndicators();
    document.querySelectorAll('#ticker-tbody tr.ticker-dragging')
        .forEach(tr => tr.classList.remove('ticker-dragging'));
}

async function tickerDrop(e, targetId) {
    e.preventDefault();
    const tr = e.currentTarget;
    const rect = tr.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    clearTickerDropIndicators();
    document.querySelectorAll('#ticker-tbody tr.ticker-dragging')
        .forEach(r => r.classList.remove('ticker-dragging'));

    const fromId = dragTickerId || (() => { try { return e.dataTransfer.getData('text/plain'); } catch (_) { return null; } })();
    dragTickerId = null;
    if (!fromId || fromId === targetId) return;

    const fromIndex = allTicker.findIndex(r => r.id === fromId);
    let toIndex = allTicker.findIndex(r => r.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    if (after) toIndex += 1;

    const [moved] = allTicker.splice(fromIndex, 1);
    // splice() target shifts down after removal when moving downwards
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    allTicker.splice(insertAt, 0, moved);
    renderTable();
    await persistNewTickerOrder(moved);
}

async function persistNewTickerOrder(movedRow) {
    const changed = [];
    allTicker.forEach((r, i) => {
        if ((r.sort_order || 0) !== i) changed.push({ id: r.id, sort_order: i });
    });
    if (!changed.length) { renderPreview(); return; }

    try {
        await newsApi('reorder-ticker', { method: 'POST', body: { rows: changed } });
    } catch (e) {
        showToast('Gagal menyusun semula: ' + e.message, 'error');
        await loadTicker();
        renderPreview();
        return;
    }
    await neonLog('news_ticker_reorder', tickerLabelPlain(movedRow), 'Susunan baris diubah (seret).', 'news_activity_log');
    await loadTicker();
    renderPreview();
}

function tickerLabelPlain(row) {
    return row.kind === 'khutbah' ? (row.prefix || 'Khutbah') : (row.message || '');
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────
function toggleKindFields() {
    const kind = document.getElementById('edit-kind').value;
    document.getElementById('static-field-group').style.display  = kind === 'static'  ? '' : 'none';
    document.getElementById('khutbah-field-group').style.display = kind === 'khutbah' ? '' : 'none';
    if (kind === 'khutbah') {
        const title = cachedSettings.khutbah_last_title;
        const fetchedAt = cachedSettings.khutbah_last_fetched_at;
        document.getElementById('khutbah-last-title-note').textContent = title
            ? `Tajuk tersimpan terakhir: "${title}"${fetchedAt ? ` (${formatRelativeMY(fetchedAt)})` : ''}`
            : 'Belum ada tajuk khutbah tersimpan lagi — akan diambil semasa Terbitkan pertama.';
    }
}

function openAddModal() {
    document.getElementById('ticker-modal-title').textContent = 'Tambah Baris';
    document.getElementById('edit-id').value       = '';
    document.getElementById('edit-kind').value      = 'static';
    document.getElementById('edit-message').value   = '';
    document.getElementById('edit-prefix').value    = 'Khutbah Jumaat Minggu Ini: ';
    document.getElementById('edit-start').value     = '';
    document.getElementById('edit-end').value       = '';
    document.getElementById('edit-enabled').checked = true;
    toggleKindFields();
    updateMessageCounter();
    updatePrefixCounter();
    document.getElementById('ticker-modal').classList.add('open');
}

function openEditModal(id) {
    const r = allTicker.find(x => x.id === id);
    if (!r) return;

    document.getElementById('ticker-modal-title').textContent = 'Edit Baris';
    document.getElementById('edit-id').value       = r.id;
    document.getElementById('edit-kind').value      = r.kind;
    document.getElementById('edit-message').value   = r.message || '';
    document.getElementById('edit-prefix').value    = r.prefix || '';
    // datetime-local requires exactly YYYY-MM-DDTHH:MM (no seconds) — the DB
    // returns a full timestamp string, so slice it down to fit the input.
    document.getElementById('edit-start').value     = (r.start_at || '').slice(0, 16);
    document.getElementById('edit-end').value       = (r.end_at || '').slice(0, 16);
    document.getElementById('edit-enabled').checked = r.enabled !== false;
    toggleKindFields();
    updateMessageCounter();
    updatePrefixCounter();
    document.getElementById('ticker-modal').classList.add('open');
}

// ─── Duplicate: same timeframe, new message ───────────────────────────────────
// Prefills the add-modal from an existing row so a second line sharing the
// same schedule only needs its text tweaked. edit-id stays empty so
// saveTickerRow() takes the insert + news_ticker_create path (sort_order
// auto-assigned as max+1 there).
function duplicateTicker(id) {
    const r = allTicker.find(x => x.id === id);
    if (!r) return;

    openAddModal();
    document.getElementById('ticker-modal-title').textContent = 'Duplikat Baris';
    document.getElementById('edit-kind').value      = r.kind || 'static';
    document.getElementById('edit-message').value   = r.message || '';
    document.getElementById('edit-prefix').value    = r.prefix || '';
    document.getElementById('edit-start').value     = (r.start_at || '').slice(0, 16);
    document.getElementById('edit-end').value       = (r.end_at || '').slice(0, 16);
    document.getElementById('edit-enabled').checked = r.enabled !== false;
    toggleKindFields();
    updateMessageCounter();
    updatePrefixCounter();
}

function closeModal() {
    document.getElementById('ticker-modal').classList.remove('open');
}

function handleOverlay(e) {
    if (e.target.id === 'ticker-modal') closeModal();
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function buildTickerDiffText(before, after) {
    const parts = [];
    if (tickerLabelPlain(before) !== tickerLabelPlain(after)) {
        parts.push(`Baris: "${tickerLabelPlain(before)}" → "${tickerLabelPlain(after)}"`);
    }
    if ((before.enabled !== false) !== (after.enabled !== false)) {
        parts.push(`Status: ${before.enabled !== false ? 'Aktif' : 'Dimatikan'} → ${after.enabled !== false ? 'Aktif' : 'Dimatikan'}`);
    }
    if ((before.start_at || null) !== (after.start_at || null) || (before.end_at || null) !== (after.end_at || null)) {
        parts.push('Tempoh dikemaskini');
    }
    return parts.length ? parts.join('; ') : null;
}

async function saveTickerRow() {
    const id      = document.getElementById('edit-id').value.trim();
    const kind    = document.getElementById('edit-kind').value;
    const message = document.getElementById('edit-message').value.trim();
    const prefix  = document.getElementById('edit-prefix').value.trim();
    const startAt = document.getElementById('edit-start').value || null;
    const endAt   = document.getElementById('edit-end').value || null;
    const enabled = document.getElementById('edit-enabled').checked;

    if (kind === 'static' && !message) {
        showToast('Teks baris diperlukan', 'error');
        document.getElementById('edit-message').focus();
        return;
    }
    if (kind === 'static' && message.length > 74) {
        showToast('Teks baris maksimum 74 aksara (supaya tidak melilit pada paparan Xibo)', 'error');
        document.getElementById('edit-message').focus();
        return;
    }
    if (kind === 'khutbah' && prefix.length > 74) {
        showToast('Awalan maksimum 74 aksara', 'error');
        document.getElementById('edit-prefix').focus();
        return;
    }

    const before = id ? allTicker.find(r => r.id === id) : null;

    const row = {
        id: id || undefined,
        kind,
        message: kind === 'static' ? message : null,
        prefix:  kind === 'khutbah' ? (prefix || null) : null,
        start_at: startAt,
        end_at:   endAt,
        enabled,
    };
    if (!id) {
        row.sort_order = allTicker.length ? Math.max(...allTicker.map(r => r.sort_order || 0)) + 1 : 0;
    }

    const btn = document.getElementById('ticker-save-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    try {
        await newsApi('save-ticker', { method: 'POST', body: { row } });
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Simpan';

    showToast(id ? 'Baris dikemaskini' : 'Baris berjaya ditambah', 'success');
    if (id) {
        const diff = buildTickerDiffText(before, row);
        if (diff) await neonLog('news_ticker_update', tickerLabelPlain(row), diff, 'news_activity_log');
    } else {
        await neonLog('news_ticker_create', tickerLabelPlain(row), 'Baris baharu ditambah.', 'news_activity_log');
    }
    closeModal();
    await loadTicker();
    renderPreview();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id, label) {
    deletingTickerId = id;
    document.getElementById('delete-label').textContent = label;
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    deletingTickerId = null;
}

function handleDeleteOverlay(e) {
    if (e.target.id === 'delete-modal') closeDeleteModal();
}

async function confirmDelete() {
    if (!deletingTickerId) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true; btn.textContent = 'Memadam...';

    const target = allTicker.find(r => r.id === deletingTickerId);
    try {
        await newsApi('delete-ticker', { method: 'POST', body: { id: deletingTickerId } });
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Padam';
        showToast('Gagal memadam: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Padam';

    showToast('Baris dipadam', 'success');
    await neonLog('news_ticker_delete', target ? tickerLabelPlain(target) : '(tidak diketahui)', 'Baris dipadam.', 'news_activity_log');
    closeDeleteModal();
    await loadTicker();
    renderPreview();
}

// ─── Tetapan (default_ticker_line) ─────────────────────────────────────────────
async function loadTickerSettings() {
    cachedSettings = await getSettings(['default_ticker_line', 'khutbah_last_title', 'khutbah_last_fetched_at']);
    document.getElementById('setting-default-line').value =
        cachedSettings.default_ticker_line || 'Selamat datang ke Masjid Al-Mukhlisin Taman Jaya 6';
}

async function saveTickerSettings() {
    const value = document.getElementById('setting-default-line').value.trim()
        || 'Selamat datang ke Masjid Al-Mukhlisin Taman Jaya 6';
    const btn = document.getElementById('save-settings-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
        await saveSetting('default_ticker_line', value);
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Simpan Tetapan';
        showToast('Gagal menyimpan tetapan: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Simpan Tetapan';

    showToast('Tetapan disimpan', 'success');
    cachedSettings.default_ticker_line = value;
    await neonLog('news_settings_update', 'default_ticker_line', `Baris lalai: ${value}`, 'news_activity_log');
    renderPreview();
}

// ─── "What will actually be published" preview ─────────────────────────────────
// Runs the EXACT same buildMovingTextJson()/isActiveNow() the real endpoint
// runs (admin/news/publish-news-pure.js, loaded as a plain global script —
// see teks-berjalan.html) against the currently-loaded rows, so this can
// never silently drift from what Terbitkan actually publishes. The khutbah
// line uses the cached last-known title (news_settings.khutbah_last_title)
// rather than a live CSV fetch — the real fetch/fail-safe/cache-write only
// happens server-side at publish time (see api/publish-news.js).
function renderPreview() {
    const list = document.getElementById('preview-list');
    if (!list) return;

    const settings = { default_ticker_line: cachedSettings.default_ticker_line };
    const khutbahTitle = cachedSettings.khutbah_last_title || null;
    const mytNow = new Date(Date.now() + TICKER_MYT_OFFSET_MS);

    const out = buildMovingTextJson(allTicker, settings, khutbahTitle, mytNow);
    list.innerHTML = out['moving-text'].map(r => `<li>${escapeHtml(r.Col1)}</li>`).join('');
}
