// ─── State ────────────────────────────────────────────────────────────────────
const projectId = new URLSearchParams(window.location.search).get('project');

let donationLimit = 50;
const DONATION_PAGE_SIZE = 50;

let project     = null;
let currentRows = [];   // last-loaded page, kept for edit/delete lookups
let totalCount  = 0;    // all rows for this project, regardless of donationLimit — used to number rows stably (oldest = Bil. 1), refreshed every loadDonations() call so it never goes stale after an add/edit/delete
let deletingId  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireInfaqAccess())) return;
    if (!projectId) {
        document.getElementById('project-header').innerHTML =
            '<p style="color:var(--text-muted)">Tiada projek dipilih. <a href="projek.html">Kembali ke senarai projek</a>.</p>';
        return;
    }
    document.getElementById('add-donation-btn').style.display = canWriteModule('infaq') ? '' : 'none';
    document.getElementById('edit-online-total-btn').style.display = canWriteModule('infaq') ? '' : 'none';
    await loadProject();
    await loadDonations();
})();

async function loadProject() {
    let out;
    try {
        out = await infaqApi('get-project', { params: { id: projectId } });
    } catch (e) {
        document.getElementById('project-header').innerHTML =
            '<p style="color:var(--text-muted)">Projek tidak dijumpai. <a href="projek.html">Kembali ke senarai projek</a>.</p>';
        return;
    }
    project = out.project;
    if (!project) {
        document.getElementById('project-header').innerHTML =
            '<p style="color:var(--text-muted)">Projek tidak dijumpai. <a href="projek.html">Kembali ke senarai projek</a>.</p>';
        return;
    }
    document.title = `Kutipan ${project.name} — Admin MAMTJ6`;
    document.getElementById('project-name').textContent = project.name;
    document.getElementById('project-status').textContent = project.is_active ? 'Aktif' : 'Selesai';
    document.getElementById('project-status').style.color = project.is_active ? 'var(--primary)' : 'var(--text-muted)';

    const launchInfo = document.getElementById('project-launch-info');
    if (project.launch_date) {
        const days = daysSince(project.launch_date);
        launchInfo.textContent = `Dilancarkan: ${formatDateMY(project.launch_date)} — ${days} hari sejak dilancarkan`;
        launchInfo.style.display = '';
    } else {
        launchInfo.style.display = 'none';
    }

    // Per-project publish: each project gets its own JSON file
    // (admin/infaq/data/<slugified-name>_<project-uuid>.json). The Terbitkan
    // button is shown for EVERY project — active or completed — since it
    // publishes THIS project's own data, never the active one's (unlike the
    // older daily.json behaviour).
    if (canWriteModule('infaq')) {
        document.getElementById('publish-project-btn').style.display = '';
    }
    await loadLastPublishedProjectNote();
}

async function handlePublishProject() {
    if (!projectId || !project) return;
    await publishInfaqProject(projectId, 'publish-project-btn');
    await loadLastPublishedProjectNote();
}

// Per-project "last published" note. Unlike the shared daily/monthly/
// perbelanjaan notes (filtered only by action), publish_project is logged for
// EVERY project, so this filters by target_label == this project's name to
// show the right project's last-published time.
async function loadLastPublishedProjectNote() {
    const el = document.getElementById('last-published-project');
    if (!el || !project) return;
    await loadLastPublishedInfaqNote('publish_project', 'last-published-project', project.name);
}

// ─── Load and render ──────────────────────────────────────────────────────────
async function loadDonations() {
    const tbody = document.getElementById('donation-tbody');
    const loadMoreBtn = document.getElementById('load-more-btn');

    // Only blank the table on the true first load (nothing on screen yet).
    // Re-fetches triggered by loadMore()/save/delete keep the existing rows
    // visible instead — collapsing to a 1-row placeholder mid-fetch shrinks
    // the page out from under the scroll position (the browser clamps
    // scroll to the new, much shorter height), which yanks a scrolled-down
    // admin back to the top; it never restores after the table re-expands.
    // Loading feedback for those re-fetches comes from the button itself.
    const isInitialLoad = currentRows.length === 0;
    if (isInitialLoad) {
        tbody.innerHTML = '<tr><td colspan="5" class="state-cell">Memuatkan...</td></tr>';
    } else if (loadMoreBtn.style.display !== 'none') {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Memuatkan...';
    }

    // One call returns the page rows + the exact total (server-side) —
    // same two facts the old code fetched with two parallel queries.
    let page;
    try {
        page = await infaqApi('list-donations', { params: { project_id: projectId, limit: donationLimit } });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-cell">Ralat: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Tunjuk 50 lagi';

    currentRows = page.rows || [];
    totalCount  = page.total ?? currentRows.length;
    renderTable();
    loadMoreBtn.style.display = currentRows.length >= donationLimit ? '' : 'none';
    await updateProgress();
}

async function updateProgress() {
    if (!project) return;
    // Server-side sum over ALL rows (never the capped page) + online total —
    // same terkumpul the publish endpoint computes via computeProjectProgress.
    let fizikal = 0;
    try {
        const out = await infaqApi('list-donations', { params: { project_id: projectId, limit: 1 } });
        fizikal = Number(out.sum || 0);
    } catch (e) {
        console.error('Gagal memuatkan jumlah kutipan projek:', e.message);
        return;
    }
    const online    = Number(project.online_total || 0);
    const terkumpul = fizikal + online;
    const peratusan = project.target_amount > 0 ? Math.round((terkumpul / project.target_amount) * 100) : 0;
    document.getElementById('progress-fill').style.width = `${Math.min(100, peratusan)}%`;
    document.getElementById('progress-text').textContent =
        `${formatRM(terkumpul)} daripada ${formatRM(project.target_amount)} (${peratusan}%)`;

    // Breakdown line + Nota block only appear once an online total is
    // actually recorded — otherwise "Terkumpul" is just the physical total
    // and the existing progress-text line already says everything there is
    // to say (no unexplained bigger number without this).
    const breakdownEl = document.getElementById('progress-breakdown');
    const notaEl       = document.getElementById('online-nota-card');
    if (project.online_total) {
        // Weekday-first phrasing ("Selasa, 30 Jun 2026") specifically for this
        // line — deliberately not formatDateMY() (shared, used all over the
        // codebase for launch_date/activity-log dates as "30 Jun 2026
        // (Selasa)"); changing that shared helper's format would ripple into
        // every other page that calls it, for a wording tweak only asked for
        // here.
        let updatedLabel = 'Tiada tarikh';
        if (project.online_total_updated_at) {
            const d = new Date(project.online_total_updated_at + 'T00:00:00');
            updatedLabel = `${HARI_MALAY[d.getDay()]}, ${d.getDate()} ${BULAN_MALAY[d.getMonth()]} ${d.getFullYear()}`;
        }
        breakdownEl.innerHTML = `Tabung Fizikal: ${formatRM(fizikal)}<br>Online: ${formatRM(online)} (dikemaskini ${updatedLabel})`;
        breakdownEl.style.display = '';
        document.getElementById('online-nota-target').textContent = formatRM(project.target_amount);
        notaEl.style.display = '';
    } else {
        breakdownEl.style.display = 'none';
        notaEl.style.display = 'none';
    }
}

// ─── Online total edit modal ────────────────────────────────────────────────
// Edits infaq_projects.online_total/online_total_updated_at directly from
// this page (moved here from projek.js's Add/Edit modal by design — this is
// where the figure is actually displayed, so it's where an admin expects to
// update it; a project-settings modal on a different page was one extra
// click removed from the number it affects).
function openOnlineTotalModal() {
    if (!project) return;
    document.getElementById('edit-online-total-amount').value = project.online_total ?? '';
    document.getElementById('edit-online-total-date').value   = project.online_total_updated_at || '';
    document.getElementById('online-total-modal').classList.add('open');
}

function closeOnlineTotalModal() {
    document.getElementById('online-total-modal').classList.remove('open');
}

function handleOnlineTotalOverlay(e) {
    if (e.target === document.getElementById('online-total-modal')) closeOnlineTotalModal();
}

function buildOnlineTotalDiffText(before, after) {
    if ((before.online_total || null) === (after.online_total || null) &&
        (before.online_total_updated_at || null) === (after.online_total_updated_at || null)) {
        return null;
    }
    const b = before.online_total ? `${formatRM(before.online_total)} (${before.online_total_updated_at ? formatDateMY(before.online_total_updated_at) : 'Tiada tarikh'})` : 'Tiada';
    const a = after.online_total  ? `${formatRM(after.online_total)} (${after.online_total_updated_at ? formatDateMY(after.online_total_updated_at) : 'Tiada tarikh'})`  : 'Tiada';
    return `Terkumpul (Online): ${b} → ${a}`;
}

async function saveOnlineTotal() {
    if (!project) return;
    const amountInput = document.getElementById('edit-online-total-amount').value;
    const dateInput    = document.getElementById('edit-online-total-date').value;

    const saveBtn = document.getElementById('save-online-total-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const before = project;
    const row = {
        online_total: amountInput ? parseFloat(amountInput) : null,
        online_total_updated_at: dateInput || null,
    };
    try {
        await infaqApi('save-online-total', { method: 'POST', body: { id: projectId, ...row } });
    } catch (e) {
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast('Jumlah terkumpul (online) dikemaskini', 'success');
    const diff = buildOnlineTotalDiffText(before, { ...before, ...row });
    if (diff) await neonLog('infaq_project_update', project.name, diff, 'infaq_activity_log');

    project = { ...project, ...row };
    closeOnlineTotalModal();
    await updateProgress();
}

function renderTable() {
    const tbody = document.getElementById('donation-tbody');
    if (!currentRows.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="state-cell">Tiada rekod kutipan lagi. Klik "+ Catat Kutipan" untuk mula.</td></tr>';
        return;
    }
    // currentRows is newest-first, so the top row (index 0) is the most
    // recently recorded donation — it gets the highest Bil., and the last
    // row gets the lowest. This makes each row's number a permanent,
    // stable reference to that one record (oldest ever recorded = Bil. 1),
    // rather than a display position that shifts as newer rows are added.
    tbody.innerHTML = currentRows.map((r, idx) => `
        <tr>
            <td data-label="Bil.">${totalCount - idx}</td>
            <td data-label="Tarikh">${escapeHtml(formatDateMY(r.tarikh))}</td>
            <td data-label="Jumlah"><strong>${escapeHtml(formatRM(r.jumlah))}</strong></td>
            <td data-label="Keterangan" style="color:var(--text-muted);font-size:0.8125rem">${escapeHtml(r.keterangan || '—')}</td>
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

function loadMore() {
    donationLimit += DONATION_PAGE_SIZE;
    loadDonations();
}

// ─── Add modal ────────────────────────────────────────────────────────────────
function openAddModal() {
    document.getElementById('donation-modal-title').textContent = 'Catat Kutipan';
    document.getElementById('edit-id').value         = '';
    document.getElementById('edit-date').value        = todayString();
    document.getElementById('edit-amount').value      = '';
    document.getElementById('edit-keterangan').value  = '';
    document.getElementById('donation-modal').classList.add('open');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(id) {
    const r = currentRows.find(x => x.id === id);
    if (!r) return;
    document.getElementById('donation-modal-title').textContent = 'Edit Kutipan';
    document.getElementById('edit-id').value         = r.id;
    document.getElementById('edit-date').value        = r.tarikh;
    document.getElementById('edit-amount').value      = r.jumlah;
    document.getElementById('edit-keterangan').value  = r.keterangan || '';
    document.getElementById('donation-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('donation-modal').classList.remove('open');
}

function handleOverlay(e) {
    if (e.target === document.getElementById('donation-modal')) closeModal();
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function buildDonationDiffText(before, after) {
    const parts = [];
    if (before.tarikh !== after.tarikh) parts.push(`Tarikh: ${before.tarikh} → ${after.tarikh}`);
    if (Number(before.jumlah) !== Number(after.jumlah)) parts.push(`Jumlah: ${formatRM(before.jumlah)} → ${formatRM(after.jumlah)}`);
    if ((before.keterangan || '') !== (after.keterangan || '')) parts.push('Keterangan dikemaskini');
    return parts.length ? parts.join('; ') : null;
}

async function saveDonation() {
    const id         = document.getElementById('edit-id').value.trim();
    const date       = document.getElementById('edit-date').value;
    const amount     = parseFloat(document.getElementById('edit-amount').value);
    const keterangan = document.getElementById('edit-keterangan').value.trim();

    if (!date) { showToast('Tarikh diperlukan', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Jumlah mesti lebih daripada 0', 'error'); document.getElementById('edit-amount').focus(); return; }

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const before = id ? currentRows.find(r => r.id === id) : null;
    const row = {
        id: id || undefined,
        project_id: projectId, tarikh: date, jumlah: amount,
        keterangan: keterangan || null,
    };

    try {
        await infaqApi('save-donation', { method: 'POST', body: { row } });
    } catch (e) {
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast(id ? 'Kutipan dikemaskini' : 'Kutipan berjaya dicatat', 'success');
    const label = `${formatRM(amount)} (${date})`;
    if (id) {
        const diff = buildDonationDiffText(before, row);
        if (diff) await neonLog('infaq_projek_kutipan_update', label, diff, 'infaq_activity_log');
    } else {
        await neonLog('infaq_projek_kutipan_create', label, keterangan || null, 'infaq_activity_log');
    }
    closeModal();
    await loadDonations();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id) {
    deletingId = id;
    const r = currentRows.find(x => x.id === id);
    document.getElementById('delete-label').textContent = r ? `${formatRM(r.jumlah)} (${formatDateMY(r.tarikh)})` : '';
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

    const target = currentRows.find(r => r.id === deletingId);
    try {
        await infaqApi('delete-donation', { method: 'POST', body: { id: deletingId } });
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Padam';
        showToast('Gagal memadam: ' + e.message, 'error');
        return;
    }

    btn.disabled = false;
    btn.textContent = 'Padam';

    showToast('Rekod kutipan dipadam', 'success');
    if (target) await neonLog('infaq_projek_kutipan_delete', `${formatRM(target.jumlah)} (${formatDateMY(target.tarikh)})`, null, 'infaq_activity_log');
    closeDeleteModal();
    await loadDonations();
}
