// ─── State ────────────────────────────────────────────────────────────────────
// infaq_perbelanjaan_bulanan is small (1 row/month at most) — fetch
// everything once and filter client-side, same reasoning as kutipan.js.
let allRows      = [];
let filterYear   = '';
let editingRow   = null;
let deletingId   = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireInfaqAccess())) return;
    const canWrite = canWriteModule('infaq');
    document.getElementById('add-perbelanjaan-btn').style.display  = canWrite ? '' : 'none';
    document.getElementById('publish-perbelanjaan-btn').style.display = canWrite ? '' : 'none';
    await Promise.all([
        loadRows(),
        loadLastPublishedInfaqNote('publish_perbelanjaan', 'last-published-perbelanjaan'),
    ]);
})();

async function loadRows() {
    const tbody = document.getElementById('expense-tbody');
    tbody.innerHTML = '<tr><td colspan="3" class="state-cell">Memuatkan...</td></tr>';

    let out;
    try {
        out = await infaqApi('list-perbelanjaan');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" class="state-cell">Ralat: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    allRows = out.rows || [];
    populateYearFilter();
    renderTable();
}

function populateYearFilter() {
    const sel = document.getElementById('filter-year');
    const years = Array.from(new Set(allRows.map(r => r.tahun)));
    const currentYear = new Date().getFullYear();
    if (!years.includes(currentYear)) years.push(currentYear);
    years.sort((a, b) => b - a);

    const previousValue = filterYear || String(currentYear);
    sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = years.includes(Number(previousValue)) ? previousValue : String(years[0]);
    filterYear = sel.value;
}

function applyYearFilter() {
    filterYear = document.getElementById('filter-year').value;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('expense-tbody');
    const rows = allRows.filter(r => String(r.tahun) === String(filterYear));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="state-cell">Tiada rekod perbelanjaan untuk tahun ini. Klik "+ Catat Perbelanjaan" untuk mula.</td></tr>';
        return;
    }

    document.getElementById('year-total').textContent = formatRM(rows.reduce((s, r) => s + Number(r.jumlah), 0));

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td data-label="Bulan"><strong>${escapeHtml(BULAN_MY[r.bulan - 1])} ${r.tahun}</strong></td>
            <td data-label="Jumlah"><strong>${escapeHtml(formatRM(r.jumlah))}</strong></td>
            <td data-label="">
                ${canWriteModule('infaq') ? `
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(r.id)}')">${ACTION_ICONS.edit}</button>
                    <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(r.id)}')">${ACTION_ICONS.delete}</button>
                </div>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

// ─── Add modal ────────────────────────────────────────────────────────────────
function openAddModal() {
    editingRow = null;
    document.getElementById('expense-modal-title').textContent = 'Catat Perbelanjaan Bulanan';
    document.getElementById('edit-id').value     = '';
    document.getElementById('edit-tahun').value  = filterYear || new Date().getFullYear();
    document.getElementById('edit-bulan').value  = new Date().getMonth() + 1;
    document.getElementById('edit-jumlah').value = '';
    document.getElementById('expense-modal').classList.add('open');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(id) {
    const r = allRows.find(x => x.id === id);
    if (!r) return;
    editingRow = r;
    document.getElementById('expense-modal-title').textContent = 'Edit Perbelanjaan Bulanan';
    document.getElementById('edit-id').value     = r.id;
    document.getElementById('edit-tahun').value  = r.tahun;
    document.getElementById('edit-bulan').value  = r.bulan;
    document.getElementById('edit-jumlah').value = r.jumlah;
    document.getElementById('expense-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('expense-modal').classList.remove('open');
}

function handleOverlay(e) {
    if (e.target === document.getElementById('expense-modal')) closeModal();
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function labelFor(r) {
    return `${BULAN_MY[r.bulan - 1]} ${r.tahun}`;
}

async function saveRow() {
    const id     = document.getElementById('edit-id').value.trim();
    const tahun  = parseInt(document.getElementById('edit-tahun').value, 10);
    const bulan  = parseInt(document.getElementById('edit-bulan').value, 10);
    const jumlah = parseFloat(document.getElementById('edit-jumlah').value);

    if (!tahun || tahun < 2000) { showToast('Tahun tidak sah', 'error'); return; }
    if (!jumlah || jumlah <= 0) { showToast('Jumlah mesti lebih daripada 0', 'error'); document.getElementById('edit-jumlah').focus(); return; }

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    // Upsert on (tahun, bulan) — same reasoning as kutipan.js: recording a
    // month that already has a total should replace it, not error out.
    try {
        await infaqApi('save-perbelanjaan', { method: 'POST', body: { row: { tahun, bulan, jumlah } } });
    } catch (e) {
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast('Perbelanjaan bulanan disimpan', 'success');
    const label = labelFor({ tahun, bulan });
    if (editingRow && Number(editingRow.jumlah) !== jumlah) {
        await neonLog('infaq_perbelanjaan_update', label, `Jumlah: ${formatRM(editingRow.jumlah)} → ${formatRM(jumlah)}`, 'infaq_activity_log');
    } else if (!editingRow) {
        await neonLog('infaq_perbelanjaan_create', label, formatRM(jumlah), 'infaq_activity_log');
    }
    closeModal();
    await loadRows();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id) {
    deletingId = id;
    const r = allRows.find(x => x.id === id);
    document.getElementById('delete-label').textContent = r ? labelFor(r) : '';
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    deletingId = null;
}

function handleDeleteOverlay(e) {
    if (e.target === document.getElementById('delete-modal')) closeDeleteModal();
}

async function confirmDelete() {
    if (!deletingId) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Memadam...';

    const target = allRows.find(r => r.id === deletingId);
    try {
        await infaqApi('delete-perbelanjaan', { method: 'POST', body: { id: deletingId } });
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Padam';
        showToast('Gagal memadam: ' + e.message, 'error');
        return;
    }

    btn.disabled = false;
    btn.textContent = 'Padam';

    showToast('Rekod perbelanjaan dipadam', 'success');
    if (target) await neonLog('infaq_perbelanjaan_delete', labelFor(target), null, 'infaq_activity_log');
    closeDeleteModal();
    await loadRows();
}
