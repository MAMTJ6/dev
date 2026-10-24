// ─── State ────────────────────────────────────────────────────────────────────
let allUstaz          = [];
let deletingId        = null;
let pendingRemovePoster = false;
let pendingRemoveSquarePoster = false;
let pendingRemoveProfile = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireModuleAccess('kuliah'))) return;
    document.getElementById('add-ustaz-btn').style.display = canWriteModule('kuliah') ? '' : 'none';
    document.getElementById('publish-ustaz-btn').style.display = canWriteModule('kuliah') ? '' : 'none';
    await loadUstaz();
    await loadLastPublishedUstazNote();
    setupPosterPreview();
}

// ─── Load and render ──────────────────────────────────────────────────────────
async function loadUstaz() {
    let data;
    try {
        const out = await kuliahApi('ustaz');
        data = out.ustaz;
    } catch (e) {
        showToast('Gagal memuatkan senarai penceramah: ' + e.message, 'error');
        return;
    }
    allUstaz = (data || []).sort((a, b) =>
        a.short_name.localeCompare(b.short_name, undefined, { numeric: true, sensitivity: 'base' })
    );
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('ustaz-tbody');

    if (allUstaz.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="state-cell">Tiada penceramah lagi. Klik "+ Tambah Penceramah" untuk mula.</td></tr>';
        return;
    }

    tbody.innerHTML = allUstaz.map((u, i) => `
        <tr>
            <td data-label="#">${i}</td>
            <td data-label="Poster">
                ${u.poster_url
                    ? `<img src="${escapeHtml(u.poster_url)}" class="poster-thumb" alt="Poster ${escapeHtml(u.short_name)}" loading="lazy">`
                    : `<div class="no-poster">Tiada poster</div>`
                }
            </td>
            <td data-label="Mugshot">
                ${u.profile_url
                    ? `<img src="${escapeHtml(u.profile_url)}" class="poster-thumb" alt="Mugshot ${escapeHtml(u.short_name)}" loading="lazy">`
                    : `<div class="no-poster">Tiada</div>`
                }
            </td>
            <td data-label="Nama Penuh"><strong>${escapeHtml(u.full_name)}</strong></td>
            <td data-label="Nama Ringkas" style="color:var(--text-muted)">${escapeHtml(u.short_name)}</td>
            <td data-label="Jawatan" style="color:var(--text-muted);font-size:0.8125rem">${escapeHtml(u.jawatan || '—')}</td>
            <td data-label="Tajuk Kuliah" style="color:var(--text-muted);font-size:0.8125rem">${escapeHtml(u.tajuk_kuliah || '—')}</td>
            <td data-label="">
                ${canWriteModule('kuliah') ? `
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(u.id)}')">${ACTION_ICONS.edit}</button>
                    <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(u.id)}', '${escapeHtml(u.full_name)}')">${ACTION_ICONS.delete}</button>
                </div>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

// ─── Add modal ────────────────────────────────────────────────────────────────
function openAddModal() {
    document.getElementById('ustaz-modal-title').textContent = 'Tambah Penceramah';
    document.getElementById('edit-id').value          = '';
    document.getElementById('edit-fullname').value    = '';
    document.getElementById('edit-shortname').value   = '';
    document.getElementById('edit-topic').value       = '';
    document.getElementById('edit-jawatan').value     = '';
    document.getElementById('edit-is-public').checked = true;
    document.getElementById('edit-poster').value      = '';
    document.getElementById('edit-poster-url').value  = '';
    document.getElementById('poster-preview').innerHTML = '';
    document.getElementById('poster-current-group').style.display = 'none';
    pendingRemovePoster = false;
    document.getElementById('edit-poster-square').value      = '';
    document.getElementById('edit-poster-square-url').value  = '';
    document.getElementById('poster-square-preview').innerHTML = '';
    document.getElementById('poster-square-current-group').style.display = 'none';
    pendingRemoveSquarePoster = false;
    document.getElementById('edit-profile').value      = '';
    document.getElementById('edit-profile-url').value  = '';
    document.getElementById('profile-preview').innerHTML = '';
    document.getElementById('profile-current-group').style.display = 'none';
    pendingRemoveProfile = false;
    document.getElementById('ustaz-modal').classList.add('open');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(id) {
    const u = allUstaz.find(x => x.id === id);
    if (!u) return;

    document.getElementById('ustaz-modal-title').textContent = 'Edit Penceramah';
    document.getElementById('edit-id').value          = u.id;
    document.getElementById('edit-fullname').value    = u.full_name;
    document.getElementById('edit-shortname').value   = u.short_name;
    document.getElementById('edit-topic').value       = u.tajuk_kuliah || '';
    document.getElementById('edit-jawatan').value     = u.jawatan || '';
    document.getElementById('edit-is-public').checked = u.is_public !== false;
    document.getElementById('edit-poster').value      = '';
    document.getElementById('edit-poster-url').value  = '';
    document.getElementById('poster-preview').innerHTML = '';
    pendingRemovePoster = false;

    if (u.poster_url) {
        document.getElementById('poster-current-group').style.display = '';
        document.getElementById('poster-current-img').src = u.poster_url;
        document.getElementById('poster-current-url').textContent = u.poster_url;
    } else {
        document.getElementById('poster-current-group').style.display = 'none';
    }

    document.getElementById('edit-poster-square').value      = '';
    document.getElementById('edit-poster-square-url').value  = '';
    document.getElementById('poster-square-preview').innerHTML = '';
    pendingRemoveSquarePoster = false;

    if (u.square_url) {
        document.getElementById('poster-square-current-group').style.display = '';
        document.getElementById('poster-square-current-img').src = u.square_url;
        document.getElementById('poster-square-current-url').textContent = u.square_url;
    } else {
        document.getElementById('poster-square-current-group').style.display = 'none';
    }

    document.getElementById('edit-profile').value      = '';
    document.getElementById('edit-profile-url').value  = '';
    document.getElementById('profile-preview').innerHTML = '';
    pendingRemoveProfile = false;

    if (u.profile_url) {
        document.getElementById('profile-current-group').style.display = '';
        document.getElementById('profile-current-img').src = u.profile_url;
        document.getElementById('profile-current-url').textContent = u.profile_url;
    } else {
        document.getElementById('profile-current-group').style.display = 'none';
    }

    document.getElementById('ustaz-modal').classList.add('open');
}

function closeUstazModal() {
    document.getElementById('ustaz-modal').classList.remove('open');
    pendingRemovePoster = false;
    pendingRemoveSquarePoster = false;
    pendingRemoveProfile = false;
}

function removePoster() {
    pendingRemovePoster = true;
    document.getElementById('poster-current-group').style.display = 'none';
    document.getElementById('edit-poster').value     = '';
    document.getElementById('edit-poster-url').value = '';
    document.getElementById('poster-preview').innerHTML = '';
}

function removeSquarePoster() {
    pendingRemoveSquarePoster = true;
    document.getElementById('poster-square-current-group').style.display = 'none';
    document.getElementById('edit-poster-square').value     = '';
    document.getElementById('edit-poster-square-url').value = '';
    document.getElementById('poster-square-preview').innerHTML = '';
}

function removeProfile() {
    pendingRemoveProfile = true;
    document.getElementById('profile-current-group').style.display = 'none';
    document.getElementById('edit-profile').value     = '';
    document.getElementById('edit-profile-url').value = '';
    document.getElementById('profile-preview').innerHTML = '';
}

function handleUstazOverlay(e) {
    if (e.target === document.getElementById('ustaz-modal')) closeUstazModal();
}

// ─── Save ustaz ───────────────────────────────────────────────────────────────
// Compares the pre-write ustaz row against the values about to be saved and
// returns a human-readable diff string, or null if nothing actually changed.
function buildUstazDiffText(before, after) {
    const parts = [];
    if (before.full_name !== after.full_name) {
        parts.push(`Nama Penuh: "${before.full_name}" → "${after.full_name}"`);
    }
    if (before.short_name !== after.short_name) {
        parts.push(`Nama Ringkas: "${before.short_name}" → "${after.short_name}"`);
    }
    if ((before.tajuk_kuliah || null) !== (after.tajuk_kuliah || null)) {
        parts.push(`Tajuk Kuliah: ${before.tajuk_kuliah ? `"${before.tajuk_kuliah}"` : 'Tiada'} → ${after.tajuk_kuliah ? `"${after.tajuk_kuliah}"` : 'Tiada'}`);
    }
    if ((before.jawatan || null) !== (after.jawatan || null)) {
        parts.push(`Jawatan: ${before.jawatan ? `"${before.jawatan}"` : 'Tiada'} → ${after.jawatan ? `"${after.jawatan}"` : 'Tiada'}`);
    }
    if ((before.is_public !== false) !== after.is_public) {
        parts.push(after.is_public ? 'Ditunjuk dalam senarai awam' : 'Disembunyi dari senarai awam');
    }
    if (after.posterChanged) {
        parts.push(after.posterRemoved ? 'Poster dibuang' : 'Poster dikemaskini');
    }
    if (after.squarePosterChanged) {
        parts.push(after.squarePosterRemoved ? 'Poster segi empat sama dibuang' : 'Poster segi empat sama dikemaskini');
    }
    if (after.profileChanged) {
        parts.push(after.profileRemoved ? 'Mugshot dibuang' : 'Mugshot dikemaskini');
    }
    return parts.length ? parts.join('; ') : null;
}

async function saveUstaz() {
    const id             = document.getElementById('edit-id').value.trim();
    const fullName       = document.getElementById('edit-fullname').value.trim();
    const shortName      = document.getElementById('edit-shortname').value.trim();
    const topic          = document.getElementById('edit-topic').value.trim();
    const jawatan        = document.getElementById('edit-jawatan').value.trim();
    const isPublic       = document.getElementById('edit-is-public').checked;
    const posterFile     = document.getElementById('edit-poster').files[0];
    const posterUrlInput = document.getElementById('edit-poster-url').value.trim();
    const squareFile      = document.getElementById('edit-poster-square').files[0];
    const squareUrlInput  = document.getElementById('edit-poster-square-url').value.trim();
    const profileFile      = document.getElementById('edit-profile').files[0];
    const profileUrlInput  = document.getElementById('edit-profile-url').value.trim();

    if (!fullName) {
        showToast('Nama penuh diperlukan', 'error');
        document.getElementById('edit-fullname').focus();
        return;
    }
    if (!shortName) {
        showToast('Nama ringkas diperlukan', 'error');
        document.getElementById('edit-shortname').focus();
        return;
    }
    if (posterFile && posterUrlInput) {
        showToast('Pilih sama ada muat naik fail atau URL gambar, bukan kedua-dua.', 'error');
        return;
    }
    if (squareFile && squareUrlInput) {
        showToast('Pilih sama ada muat naik fail atau URL gambar segi empat sama, bukan kedua-dua.', 'error');
        return;
    }
    if (profileFile && profileUrlInput) {
        showToast('Pilih sama ada muat naik fail atau URL mugshot, bukan kedua-dua.', 'error');
        return;
    }

    const saveBtn = document.getElementById('ustaz-save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const before = id ? allUstaz.find(u => u.id === id) : null;

    // Poster images go to Supabase Storage via /api/upload (Neon has no
    // Storage — returns an instant public https URL). URL input is used as-is.
    async function resolveImage(file, urlInput, folder, label) {
        if (file && urlInput) return { err: `Pilih sama ada muat naik fail atau URL ${label}, bukan kedua-dua.` };
        if (file) {
            try {
                return { url: await uploadImage(folder, file) };
            } catch (e) {
                return { err: `Gagal muat naik ${label}: ` + e.message };
            }
        }
        return { url: urlInput || null };
    }

    const r1 = await resolveImage(posterFile, posterUrlInput, 'posters', 'gambar');
    if (r1.err) {
        showToast(r1.err, 'error');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Simpan';
        return;
    }
    const r2 = await resolveImage(squareFile, squareUrlInput, 'posters-square', 'gambar segi empat sama');
    if (r2.err) {
        showToast(r2.err, 'error');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Simpan';
        return;
    }
    const r3 = await resolveImage(profileFile, profileUrlInput, 'profiles', 'mugshot');
    if (r3.err) {
        showToast(r3.err, 'error');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Simpan';
        return;
    }
    const newPosterUrl = r1.url;
    const newSquareUrl = r2.url;
    const newProfileUrl = r3.url;

    const payload = {
        full_name:    fullName,
        short_name:   shortName,
        tajuk_kuliah: topic || null,
        jawatan:      jawatan || null,
        is_public:    isPublic,
        updated_at:   new Date().toISOString(),
    };
    if (pendingRemovePoster) {
        payload.poster_url = null;
    } else if (newPosterUrl) {
        payload.poster_url = newPosterUrl;
    }
    if (pendingRemoveSquarePoster) {
        payload.square_url = null;
    } else if (newSquareUrl) {
        payload.square_url = newSquareUrl;
    }
    if (pendingRemoveProfile) {
        payload.profile_url = null;
    } else if (newProfileUrl) {
        payload.profile_url = newProfileUrl;
    }

    try {
        await kuliahApi('ustaz-save', {
            method: 'POST',
            body: { row: { id: id || null, ...payload } },
        });
    } catch (e) {
        if (String(e.message || '').includes('taken')) {
            showToast('Nama Ringkas "' + shortName + '" sudah digunakan oleh penceramah lain. Sila gunakan Nama Ringkas yang lain.', 'error');
        } else {
            showToast('Gagal menyimpan: ' + e.message, 'error');
        }
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast(id ? 'Penceramah dikemaskini' : 'Penceramah berjaya ditambah', 'success');
    if (id) {
        const after = {
            full_name: fullName, short_name: shortName, tajuk_kuliah: topic || null,
            jawatan: jawatan || null, is_public: isPublic,
            posterChanged: pendingRemovePoster || !!newPosterUrl, posterRemoved: pendingRemovePoster,
            squarePosterChanged: pendingRemoveSquarePoster || !!newSquareUrl, squarePosterRemoved: pendingRemoveSquarePoster,
            profileChanged: pendingRemoveProfile || !!newProfileUrl, profileRemoved: pendingRemoveProfile,
        };
        const diff = buildUstazDiffText(before, after);
        if (diff) await neonLog('ustaz_update', shortName, diff);
    } else {
        await neonLog('ustaz_create', shortName, `Penceramah baharu ditambah${topic ? `: "${topic}"` : ''}.`);
    }
    closeUstazModal();
    await loadUstaz();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function openDeleteModal(id, name) {
    deletingId = id;
    document.getElementById('delete-name').textContent = name;
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    deletingId = null;
}

function handleDeleteOverlay(e) {
    if (e.target === document.getElementById('delete-modal')) closeDeleteModal();
}

// ─── Nama Ringkas numbering-convention popup ───────────────────────────────────
function openNumberingHelp() {
    document.getElementById('numbering-help-modal').classList.add('open');
}

function closeNumberingHelp() {
    document.getElementById('numbering-help-modal').classList.remove('open');
}

function handleNumberingHelpOverlay(e) {
    if (e.target === document.getElementById('numbering-help-modal')) closeNumberingHelp();
}

async function confirmDelete() {
    if (!deletingId) return;

    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled  = true;
    btn.textContent = 'Menyemak...';

    // Guard: check if this ustaz is still referenced in the schedule
    let refCount = 0;
    try {
        const out = await kuliahApi('ustaz-delete', { method: 'POST', body: { id: deletingId, checkOnly: true } });
        refCount = out.count || 0;
    } catch (e) {
        // checkOnly unsupported on older deploys — fall through to delete,
        // the server still blocks referenced rows with 409.
        refCount = 0;
    }

    if (refCount > 0) {
        showToast(
            `Tidak boleh dipadam — penceramah ini masih ada dalam ${refCount} sesi jadual. Alih keluar dari jadual dahulu.`,
            'error', 7000
        );
        btn.disabled  = false;
        btn.textContent = 'Padam';
        closeDeleteModal();
        return;
    }

    btn.textContent = 'Memadam...';
    const target = allUstaz.find(u => u.id === deletingId);
    try {
        await kuliahApi('ustaz-delete', { method: 'POST', body: { id: deletingId } });
    } catch (e) {
        if (String(e.message || '').includes('referenced')) {
            showToast('Tidak boleh dipadam — penceramah ini masih ada dalam jadual. Alih keluar dari jadual dahulu.', 'error', 7000);
            closeDeleteModal();
        } else {
            showToast('Gagal memadam: ' + e.message, 'error');
        }
        btn.disabled  = false;
        btn.textContent = 'Padam';
        return;
    }

    btn.disabled  = false;
    btn.textContent = 'Padam';

    showToast('Penceramah berjaya dipadam', 'success');
    await neonLog('ustaz_delete', target?.short_name || '(tidak diketahui)', `Penceramah "${target?.full_name || ''}" dipadam.`);
    closeDeleteModal();
    await loadUstaz();
}

// ─── Poster preview before upload ─────────────────────────────────────────────
function setupPosterPreview() {
    wireOnePosterPreview('edit-poster', 'poster-preview');
    wireOnePosterPreview('edit-poster-square', 'poster-square-preview');
    wireOnePosterPreview('edit-profile', 'profile-preview');
}

function wireOnePosterPreview(inputId, previewId) {
    document.getElementById(inputId).addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) {
            document.getElementById(previewId).innerHTML = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = ev => {
            document.getElementById(previewId).innerHTML =
                `<img src="${ev.target.result}" class="preview-img" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    });
}

// ─── Publish penceramah (kuliah/data/penceramah.json) ─────────────────────────
async function loadLastPublishedUstazNote() {
    const el = document.getElementById('last-published-ustaz-note');
    if (!el) return;
    let row = null;
    try {
        const out = await kuliahApi('last-published', { params: { label: 'penceramah', logAction: 'publish_ustaz' } });
        row = out.row;
    } catch {
        row = null;
    }
    if (!row) {
        el.textContent = 'Senarai penceramah belum pernah diterbitkan.';
        return;
    }
    const who = row.actor_name || row.actor_email || '';
    el.textContent = `Terakhir diterbitkan: ${formatDateTimeMY(row.created_at)}${who ? ` oleh ${who}` : ''} (${formatRelativeMY(row.created_at)})`;
}

async function publishUstaz() {
    if (!canWriteModule('kuliah')) {
        showToast('Anda tiada kebenaran untuk menerbitkan', 'error');
        return;
    }
    const btn = document.getElementById('publish-ustaz-btn');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Menerbitkan...';
    try {
        const res = await fetch('/api/publish-ustaz', { method: 'POST' });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || res.statusText);
        showToast(`Penceramah diterbitkan (${out.published?.count ?? '?'} orang)`, 'success');
        await loadLastPublishedUstazNote();
    } catch (e) {
        showToast('Gagal menerbitkan: ' + (e.message || 'Ralat sambungan'), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
init();
