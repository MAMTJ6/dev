// ─── State ────────────────────────────────────────────────────────────────────
let allProjects  = [];
let activatingId = null;
let deletingId   = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireInfaqAccess())) return;
    document.getElementById('add-projek-btn').style.display = canWriteModule('infaq') ? '' : 'none';
    await loadProjects();
})();

// ─── Load and render ──────────────────────────────────────────────────────────
// Projects are a small, bounded list (like ustaz) — per-project "Terkumpul"
// totals are computed server-side in the same call, rather than one query
// per project.
async function loadProjects() {
    const tbody = document.getElementById('project-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Memuatkan...</td></tr>';

    let out;
    try {
        out = await infaqApi('list-projects');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="state-cell">Ralat: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    allProjects = out.projects || [];
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('project-tbody');
    if (!allProjects.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada projek lagi. Klik "+ Tambah Projek" untuk mula.</td></tr>';
        return;
    }
    tbody.innerHTML = allProjects.map(p => {
        const peratusan = p.target_amount > 0 ? Math.round((p.terkumpul / p.target_amount) * 100) : 0;
        return `
        <tr>
            <td data-label="Nama Projek"><strong>${escapeHtml(p.name)}</strong></td>
            <td data-label="Sasaran">${escapeHtml(formatRM(p.target_amount))}</td>
            <td data-label="Terkumpul">${escapeHtml(formatRM(p.terkumpul))}</td>
            <td data-label="Peratusan">${peratusan}%</td>
            <td data-label="Status">${p.is_active
                ? '<span style="color:var(--primary);font-weight:600">Aktif</span>'
                : '<span style="color:var(--text-muted)">Selesai</span>'}</td>
            <td data-label="">
                <div class="actions">
                    <a class="btn btn-ghost btn-sm" href="projek-kutipan.html?project=${encodeURIComponent(p.id)}">Lihat Kutipan</a>
                    ${canWriteModule('infaq') ? `
                        ${p.is_active ? '' : `<button class="btn btn-ghost btn-sm" onclick="openActivateModal('${escapeHtml(p.id)}')">Jadikan Aktif</button>`}
                        <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(p.id)}')">${ACTION_ICONS.edit}</button>
                        <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(p.id)}')">${ACTION_ICONS.delete}</button>
                    ` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ─── Add modal ────────────────────────────────────────────────────────────────
function openAddModal() {
    document.getElementById('project-modal-title').textContent = 'Tambah Projek';
    document.getElementById('edit-id').value     = '';
    document.getElementById('edit-name').value   = '';
    document.getElementById('edit-target').value = '';
    document.getElementById('edit-launch-date').value = '';
    document.getElementById('project-modal').classList.add('open');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(id) {
    const p = allProjects.find(x => x.id === id);
    if (!p) return;
    document.getElementById('project-modal-title').textContent = 'Edit Projek';
    document.getElementById('edit-id').value     = p.id;
    document.getElementById('edit-name').value   = p.name;
    document.getElementById('edit-target').value = p.target_amount;
    document.getElementById('edit-launch-date').value = p.launch_date || '';
    document.getElementById('project-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('project-modal').classList.remove('open');
}

function handleOverlay(e) {
    if (e.target === document.getElementById('project-modal')) closeModal();
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function buildProjectDiffText(before, after) {
    const parts = [];
    if (before.name !== after.name) parts.push(`Nama: "${before.name}" → "${after.name}"`);
    if (Number(before.target_amount) !== Number(after.target_amount)) {
        parts.push(`Sasaran: ${formatRM(before.target_amount)} → ${formatRM(after.target_amount)}`);
    }
    if ((before.launch_date || null) !== (after.launch_date || null)) {
        const b = before.launch_date ? formatDateMY(before.launch_date) : 'Tiada';
        const a = after.launch_date  ? formatDateMY(after.launch_date)  : 'Tiada';
        parts.push(`Tarikh Pelancaran: ${b} → ${a}`);
    }
    return parts.length ? parts.join('; ') : null;
}

async function saveProject() {
    const id         = document.getElementById('edit-id').value.trim();
    const name       = document.getElementById('edit-name').value.trim();
    const target     = parseFloat(document.getElementById('edit-target').value);
    const launchDateInput = document.getElementById('edit-launch-date').value; // '' if blank

    if (!name) { showToast('Nama projek diperlukan', 'error'); document.getElementById('edit-name').focus(); return; }
    if (!target || target <= 0) { showToast('Sasaran mesti lebih daripada 0', 'error'); document.getElementById('edit-target').focus(); return; }

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const before = id ? allProjects.find(p => p.id === id) : null;
    // launch_date is always an explicit null or a date string, never
    // undefined — so clearing a previously-set date on an update actually
    // sends null and clears the column, rather than omitting the key and
    // leaving the old value untouched.
    const row = { id: id || undefined, name, target_amount: target, launch_date: launchDateInput || null };

    try {
        await infaqApi('save-project', { method: 'POST', body: { row } });
    } catch (e) {
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast(id ? 'Projek dikemaskini' : 'Projek berjaya ditambah', 'success');
    if (id) {
        const diff = buildProjectDiffText(before, row);
        if (diff) await neonLog('infaq_project_update', name, diff, 'infaq_activity_log');
    } else {
        await neonLog('infaq_project_create', name, `Sasaran: ${formatRM(target)}`, 'infaq_activity_log');
    }
    closeModal();
    await loadProjects();
}

// ─── Activate ─────────────────────────────────────────────────────────────────
function openActivateModal(id) {
    activatingId = id;
    const target = allProjects.find(p => p.id === id);
    const current = allProjects.find(p => p.is_active);
    document.getElementById('activate-modal-text').textContent = current
        ? `Projek "${current.name}" akan ditandakan selesai, dan "${target?.name}" akan menjadi projek aktif.`
        : `"${target?.name}" akan menjadi projek aktif.`;
    document.getElementById('activate-modal').classList.add('open');
}

function closeActivateModal() {
    document.getElementById('activate-modal').classList.remove('open');
    activatingId = null;
}

function handleActivateOverlay(e) {
    if (e.target === document.getElementById('activate-modal')) closeActivateModal();
}

async function confirmActivate() {
    if (!activatingId) return;
    const btn = document.getElementById('confirm-activate-btn');
    btn.disabled = true;
    btn.textContent = 'Memproses...';

    const target = allProjects.find(p => p.id === activatingId);
    const current = allProjects.find(p => p.is_active);

    // Server deactivates the current active project FIRST, then activates
    // the target — in that order, so the partial unique index on is_active
    // (at most one true) is never transiently violated.
    try {
        await infaqApi('activate-project', { method: 'POST', body: { id: activatingId } });
    } catch (e) {
        showToast('Gagal mengaktifkan projek: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = 'Jadikan Aktif';
        return;
    }

    btn.disabled = false;
    btn.textContent = 'Jadikan Aktif';

    showToast(`Projek "${target?.name}" kini aktif`, 'success');
    await neonLog('infaq_project_activate', target?.name || '(tidak diketahui)',
        current ? `Menggantikan "${current.name}"` : null, 'infaq_activity_log');
    closeActivateModal();
    await loadProjects();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id) {
    deletingId = id;
    const p = allProjects.find(x => x.id === id);
    document.getElementById('delete-name').textContent = p?.name || '';
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
    btn.textContent = 'Menyemak...';

    // Guard: block deletion while any donation is still earmarked to this
    // project. The FK is ON DELETE SET NULL (wouldn't hard-fail), but
    // silently orphaning a donation's project attribution is a real
    // data-integrity loss worth blocking — same reasoning
    // admin/kuliah/ustaz.js's schedule-reference guard uses.
    const target = allProjects.find(p => p.id === deletingId);
    try {
        await infaqApi('delete-project', { method: 'POST', body: { id: deletingId } });
    } catch (e) {
        if (e.count > 0) {
            showToast(`Tidak boleh dipadam — ${e.count} rekod kutipan masih dikaitkan dengan projek ini.`, 'error', 7000);
            closeDeleteModal();
        } else {
            showToast('Gagal memadam: ' + e.message, 'error');
        }
        btn.disabled = false; btn.textContent = 'Padam';
        return;
    }

    btn.disabled = false;
    btn.textContent = 'Padam';

    showToast('Projek berjaya dipadam', 'success');
    await neonLog('infaq_project_delete', target?.name || '(tidak diketahui)', null, 'infaq_activity_log');
    closeDeleteModal();
    await loadProjects();
}
