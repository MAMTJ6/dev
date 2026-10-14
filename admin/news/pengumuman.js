// ─── State ────────────────────────────────────────────────────────────────────
let allAnnouncements    = [];
let deletingAnnId       = null;
let pendingRemoveImage  = false;
let updateTextCounter   = () => {};

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireNewsAccess())) return;

    const canWrite = canWriteModule('news');
    document.getElementById('add-ann-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('publish-announcements-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('save-settings-btn').style.display = canWrite ? '' : 'none';
    document.getElementById('setting-default-image').disabled = !canWrite;

    setupImagePreview();
    updateTextCounter = attachCharCounter('edit-text', 'edit-text-counter', 180);
    await Promise.all([
        loadAnnouncements(),
        loadLastPublishedNewsNote('publish_announcements', 'last-published-announcements'),
        loadAnnouncementSettings(),
    ]);
})();

// ─── Load and render ──────────────────────────────────────────────────────────
async function loadAnnouncements() {
    let out;
    try {
        out = await newsApi('list-announcements');
    } catch (e) {
        showToast('Gagal memuatkan pengumuman: ' + e.message, 'error');
        return;
    }
    allAnnouncements = out.rows || [];
    renderTable();
}

function jenisLabel(row) {
    if (row.image_url && row.body_text) return 'Imej+Teks';
    if (row.image_url) return 'Imej';
    return 'Teks';
}

// start_at/end_at are TIMESTAMP now (day+hour+minute) — a legacy bare-date
// value (YYYY-MM-DD, no time) still renders as just the date, no time shown
// (nothing to show), same "date-only is fine" leniency the DB/isActiveNow
// side already has.
function fmtDateTimeShort(value) {
    if (!value) return '';
    const str = String(value);
    const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(str);
    const d = new Date(isBareDate ? str + 'T00:00:00' : str);
    const datePart = `${d.getDate()} ${BULAN_MALAY[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
    if (isBareDate) return datePart;
    return `${datePart}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tempohLabel(row) {
    if (!row.start_at && !row.end_at) return 'Sentiasa';
    if (row.start_at && row.end_at) return `${fmtDateTimeShort(row.start_at)} — ${fmtDateTimeShort(row.end_at)}`;
    if (row.start_at) return `Dari ${fmtDateTimeShort(row.start_at)}`;
    return `Sehingga ${fmtDateTimeShort(row.end_at)}`;
}

function renderTable() {
    const tbody = document.getElementById('ann-tbody');
    const canWrite = canWriteModule('news');

    if (!allAnnouncements.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada pengumuman lagi. Klik "+ Tambah Pengumuman" untuk mula.</td></tr>';
        return;
    }

    tbody.innerHTML = allAnnouncements.map(r => `
        <tr>
            <td data-label="Susunan">${r.sort_order}</td>
            <td data-label="Tajuk"><strong>${escapeHtml(r.title)}</strong>${r.heading ? `<div style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(r.heading)}</div>` : ''}</td>
            <td data-label="Jenis">${jenisLabel(r)}</td>
            <td data-label="Tempoh" style="font-size:0.8125rem">${tempohLabel(r)}</td>
            <td data-label="Status">${statusBadgeHtml(computeStatus(r))}</td>
            <td data-label="">
                ${canWrite ? `
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(r.id)}')">${NEWS_ACTION_ICONS.edit}</button>
                    <button class="btn btn-ghost btn-sm" title="Duplicate" aria-label="Duplicate" onclick="duplicateAnnouncement('${escapeHtml(r.id)}')">${NEWS_ACTION_ICONS.duplicate}</button>
                    <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(r.id)}', '${escapeHtml(r.title)}')">${NEWS_ACTION_ICONS.delete}</button>
                </div>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────
function openAddModal() {
    document.getElementById('ann-modal-title').textContent = 'Tambah Pengumuman';
    document.getElementById('edit-id').value        = '';
    document.getElementById('edit-title').value      = '';
    document.getElementById('edit-heading').value    = '';
    document.getElementById('edit-text').value       = '';
    document.getElementById('edit-start').value      = '';
    document.getElementById('edit-end').value        = '';
    document.getElementById('edit-enabled').checked  = true;
    document.getElementById('edit-sort').value       = allAnnouncements.length
        ? Math.max(...allAnnouncements.map(a => a.sort_order || 0)) + 1 : 0;
    document.getElementById('edit-image').value      = '';
    document.getElementById('edit-image-url').value  = '';
    document.getElementById('ann-image-preview').innerHTML = '';
    document.getElementById('ann-image-current-group').style.display = 'none';
    pendingRemoveImage = false;
    updateTextCounter();
    document.getElementById('ann-modal').classList.add('open');
}

function openEditModal(id) {
    const r = allAnnouncements.find(x => x.id === id);
    if (!r) return;

    document.getElementById('ann-modal-title').textContent = 'Edit Pengumuman';
    document.getElementById('edit-id').value        = r.id;
    document.getElementById('edit-title').value      = r.title;
    document.getElementById('edit-heading').value    = r.heading || '';
    document.getElementById('edit-text').value       = r.body_text || '';
    // datetime-local requires exactly YYYY-MM-DDTHH:MM (no seconds) — the DB
    // returns a full timestamp string, so slice it down to fit the input.
    document.getElementById('edit-start').value      = (r.start_at || '').slice(0, 16);
    document.getElementById('edit-end').value        = (r.end_at || '').slice(0, 16);
    document.getElementById('edit-enabled').checked  = r.enabled !== false;
    document.getElementById('edit-sort').value       = r.sort_order || 0;
    document.getElementById('edit-image').value      = '';
    document.getElementById('edit-image-url').value  = '';
    document.getElementById('ann-image-preview').innerHTML = '';
    pendingRemoveImage = false;

    if (r.image_url) {
        document.getElementById('ann-image-current-group').style.display = '';
        document.getElementById('ann-image-current-img').src = r.image_url;
    } else {
        document.getElementById('ann-image-current-group').style.display = 'none';
    }

    updateTextCounter();
    document.getElementById('ann-modal').classList.add('open');
}

// ─── Duplicate: same timeframe, new message ───────────────────────────────────
// Prefills the add-modal from an existing row so a second message sharing the
// same schedule only needs its text/image tweaked. edit-id stays empty so
// saveAnnouncement() takes the insert + news_announcement_create path. The
// existing image_url (if any) is reused via the URL field — no re-upload.
function duplicateAnnouncement(id) {
    const r = allAnnouncements.find(x => x.id === id);
    if (!r) return;

    openAddModal();
    document.getElementById('ann-modal-title').textContent = 'Duplikat Pengumuman';
    document.getElementById('edit-title').value      = `${r.title || ''} (salinan)`;
    document.getElementById('edit-heading').value    = r.heading || '';
    document.getElementById('edit-text').value       = r.body_text || '';
    document.getElementById('edit-start').value      = (r.start_at || '').slice(0, 16);
    document.getElementById('edit-end').value        = (r.end_at || '').slice(0, 16);
    document.getElementById('edit-enabled').checked  = r.enabled !== false;
    if (r.image_url) {
        document.getElementById('edit-image-url').value = r.image_url;
        document.getElementById('ann-image-preview').innerHTML =
            `<img src="${escapeHtml(r.image_url)}" class="preview-img" alt="Preview">`;
    }

    updateTextCounter();
}

function closeModal() {
    document.getElementById('ann-modal').classList.remove('open');
    pendingRemoveImage = false;
}

function handleOverlay(e) {
    if (e.target.id === 'ann-modal') closeModal();
}

function removeAnnImage() {
    pendingRemoveImage = true;
    document.getElementById('ann-image-current-group').style.display = 'none';
    document.getElementById('edit-image').value     = '';
    document.getElementById('edit-image-url').value = '';
    document.getElementById('ann-image-preview').innerHTML = '';
}

// ─── Save ─────────────────────────────────────────────────────────────────────
// Compares the pre-write row against the values about to be saved and
// returns a human-readable diff string, or null if nothing actually changed.
function buildAnnouncementDiffText(before, after) {
    const parts = [];
    if (before.title !== after.title) parts.push(`Tajuk: "${before.title}" → "${after.title}"`);
    if ((before.enabled !== false) !== (after.enabled !== false)) {
        parts.push(`Status: ${before.enabled !== false ? 'Aktif' : 'Dimatikan'} → ${after.enabled !== false ? 'Aktif' : 'Dimatikan'}`);
    }
    if ((before.start_at || null) !== (after.start_at || null) || (before.end_at || null) !== (after.end_at || null)) {
        parts.push(`Tempoh dikemaskini`);
    }
    if (after.imageChanged) parts.push(after.imageRemoved ? 'Imej dibuang' : 'Imej dikemaskini');
    if ((before.body_text || null) !== (after.body_text || null)) parts.push('Teks dikemaskini');
    return parts.length ? parts.join('; ') : null;
}

async function saveAnnouncement() {
    const id        = document.getElementById('edit-id').value.trim();
    const title     = document.getElementById('edit-title').value.trim();
    const heading   = document.getElementById('edit-heading').value.trim();
    const text      = document.getElementById('edit-text').value.trim();
    const startAt   = document.getElementById('edit-start').value || null;
    const endAt     = document.getElementById('edit-end').value || null;
    const enabled   = document.getElementById('edit-enabled').checked;
    const sortOrder = parseInt(document.getElementById('edit-sort').value, 10) || 0;
    const imageFile = document.getElementById('edit-image').files[0];
    const imageUrlInput = document.getElementById('edit-image-url').value.trim();

    if (!title) { showToast('Tajuk diperlukan', 'error'); document.getElementById('edit-title').focus(); return; }
    if (text.length > 180) {
        showToast('Teks maksimum 180 aksara (supaya muat dalam ruang paparan Xibo)', 'error');
        document.getElementById('edit-text').focus();
        return;
    }
    if (imageFile && imageUrlInput) { showToast('Pilih sama ada muat naik fail atau URL imej, bukan kedua-dua.', 'error'); return; }

    const before = id ? allAnnouncements.find(a => a.id === id) : null;
    const existingImage = before?.image_url || null;
    const willHaveImage = pendingRemoveImage ? false : !!(imageFile || imageUrlInput || existingImage);
    if (!willHaveImage && !text) {
        showToast('Perlu sekurang-kurangnya imej ATAU teks.', 'error');
        return;
    }

    const saveBtn = document.getElementById('ann-save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    let newImageUrl = null;
    if (imageFile) {
        // Repo upload via /api/upload (Neon has no Storage) — returns a
        // /news/assets/announcements/... path to store in Neon.
        try {
            newImageUrl = await uploadImage('announcements', imageFile);
        } catch (e) {
            showToast('Gagal muat naik imej: ' + e.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Simpan';
            return;
        }
    } else if (imageUrlInput) {
        newImageUrl = imageUrlInput;
    }

    const row = {
        id: id || undefined,
        title,
        heading:    heading || null,
        body_text:  text || null,
        start_at:   startAt,
        end_at:     endAt,
        enabled,
        sort_order: sortOrder,
    };
    if (pendingRemoveImage) {
        row.image_url = null;
    } else if (newImageUrl) {
        row.image_url = newImageUrl;
    } else if (id) {
        row.image_url = before?.image_url || null;
    }

    try {
        await newsApi('save-announcement', { method: 'POST', body: { row } });
    } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Simpan';

    showToast(id ? 'Pengumuman dikemaskini' : 'Pengumuman berjaya ditambah', 'success');
    if (id) {
        const after = {
            title, enabled, start_at: startAt, end_at: endAt, body_text: text || null,
            imageChanged: pendingRemoveImage || !!newImageUrl, imageRemoved: pendingRemoveImage,
        };
        const diff = buildAnnouncementDiffText(before, after);
        if (diff) await neonLog('news_announcement_update', title, diff, 'news_activity_log');
    } else {
        await neonLog('news_announcement_create', title, 'Pengumuman baharu ditambah.', 'news_activity_log');
    }
    closeModal();
    await loadAnnouncements();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id, title) {
    deletingAnnId = id;
    document.getElementById('delete-title').textContent = title;
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    deletingAnnId = null;
}

function handleDeleteOverlay(e) {
    if (e.target.id === 'delete-modal') closeDeleteModal();
}

async function confirmDelete() {
    if (!deletingAnnId) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true; btn.textContent = 'Memadam...';

    const target = allAnnouncements.find(a => a.id === deletingAnnId);
    try {
        await newsApi('delete-announcement', { method: 'POST', body: { id: deletingAnnId } });
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Padam';
        showToast('Gagal memadam: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Padam';

    showToast('Pengumuman dipadam', 'success');
    await neonLog('news_announcement_delete', target?.title || '(tidak diketahui)', 'Pengumuman dipadam.', 'news_activity_log');
    closeDeleteModal();
    await loadAnnouncements();
}

// ─── Image preview before upload ──────────────────────────────────────────────
function setupImagePreview() {
    document.getElementById('edit-image').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) { document.getElementById('ann-image-preview').innerHTML = ''; return; }
        const reader = new FileReader();
        reader.onload = ev => {
            document.getElementById('ann-image-preview').innerHTML =
                `<img src="${ev.target.result}" class="preview-img" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    });
}

// ─── Tetapan (default_image) ──────────────────────────────────────────────────
async function loadAnnouncementSettings() {
    document.getElementById('setting-default-image').value = await getSetting('default_image', '/news/default.svg');
}

async function saveAnnouncementSettings() {
    const value = document.getElementById('setting-default-image').value.trim() || '/news/default.svg';
    const btn = document.getElementById('save-settings-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
        await saveSetting('default_image', value);
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Simpan Tetapan';
        showToast('Gagal menyimpan tetapan: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Simpan Tetapan';

    showToast('Tetapan disimpan', 'success');
    await neonLog('news_settings_update', 'default_image', `Imej lalai: ${value}`, 'news_activity_log');
}
