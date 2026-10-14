// ─── State ────────────────────────────────────────────────────────────────────
let allStaff       = [];
let deletingId      = null;
let pendingPinHash  = null; // set by generateNewPin(); included in the next save

// Admin roster API (Neon, via /api/staff-login?action=... cookie session).
// Mirrors kuliahApi() in /admin/kuliah/kuliah-api.js for this endpoint.
async function staffApi(action, { method = 'GET', body = null } = {}) {
    const res = await fetch(`/api/staff-login?action=${encodeURIComponent(action)}`, {
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

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireModuleAccess('staff'))) return;
    document.getElementById('add-staff-btn').style.display = canWriteModule('staff') ? '' : 'none';
    await loadStaff();
}

// ─── Load and render ──────────────────────────────────────────────────────────
// The endpoint returns has_pin (boolean) instead of the hash itself —
// the browser only needs to know whether a PIN is set, never the hash.
// (Same trust-model reasoning as before: this page has no reason to ever
// hold pin_hash/device_session_token in the browser.)
async function loadStaff() {
    let data;
    try {
        data = await staffApi('list');
    } catch (e) {
        showToast('Gagal memuatkan senarai staf: ' + e.message, 'error');
        return;
    }
    allStaff = ((data && data.staff) || []).map(r => ({ ...r, pin_hash: r.has_pin ? 'set' : null })).sort((a, b) =>
        a.full_name.localeCompare(b.full_name, undefined, { numeric: true, sensitivity: 'base' })
    );
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('staff-tbody');

    if (allStaff.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada staf lagi. Klik "+ Tambah Staf" untuk mula.</td></tr>';
        return;
    }

    tbody.innerHTML = allStaff.map((s, i) => `
        <tr>
            <td data-label="#">${i + 1}</td>
            <td data-label="Nama Penuh"><strong>${escapeHtml(s.full_name)}</strong></td>
            <td data-label="Telefon" style="color:var(--text-muted)">${escapeHtml(s.phone || '—')}</td>
            <td data-label="Emel" style="color:var(--text-muted)">${escapeHtml(s.email || '—')}</td>
            <td data-label="Status">${statusBadgeHtml(s)}</td>
            <td data-label="">
                ${canWriteModule('staff') ? `
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(s.id)}')">${ACTION_ICONS.edit}</button>
                    <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="openDeleteModal('${escapeHtml(s.id)}', '${escapeHtml(s.full_name)}')">${ACTION_ICONS.delete}</button>
                </div>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function statusBadgeHtml(s) {
    if (!s.enabled) return '<span class="staff-status-badge staff-status-disabled">Tidak Aktif</span>';
    if (s.locked_until && new Date(s.locked_until).getTime() > Date.now()) {
        return '<span class="staff-status-badge staff-status-locked">Dikunci</span>';
    }
    return '<span class="staff-status-badge staff-status-active">Aktif</span>';
}

// ─── Add modal ────────────────────────────────────────────────────────────────
function openAddModal() {
    document.getElementById('staff-modal-title').textContent = 'Tambah Staf';
    document.getElementById('edit-id').value        = '';
    document.getElementById('edit-fullname').value  = '';
    document.getElementById('edit-phone').value     = '';
    document.getElementById('edit-email').value     = '';
    document.getElementById('edit-enabled').checked = true;
    document.getElementById('pin-status-text').textContent = 'PIN belum ditetapkan.';
    document.getElementById('pin-reveal-box').style.display = 'none';
    document.getElementById('manual-pin-input').value = '';
    document.getElementById('lock-status-group').style.display = 'none';
    pendingPinHash = null;
    document.getElementById('staff-modal').classList.add('open');
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(id) {
    const s = allStaff.find(x => x.id === id);
    if (!s) return;

    document.getElementById('staff-modal-title').textContent = 'Edit Staf';
    document.getElementById('edit-id').value        = s.id;
    document.getElementById('edit-fullname').value  = s.full_name;
    document.getElementById('edit-phone').value     = s.phone || '';
    document.getElementById('edit-email').value     = s.email || '';
    document.getElementById('edit-enabled').checked = s.enabled !== false;
    document.getElementById('pin-status-text').textContent = s.pin_hash ? 'PIN telah ditetapkan.' : 'PIN belum ditetapkan.';
    document.getElementById('pin-reveal-box').style.display = 'none';
    document.getElementById('manual-pin-input').value = '';
    pendingPinHash = null;

    const isLockedNow = s.locked_until && new Date(s.locked_until).getTime() > Date.now();
    document.getElementById('lock-status-group').style.display = isLockedNow ? '' : 'none';
    if (isLockedNow) {
        document.getElementById('lock-status-text').textContent =
            `Dikunci sehingga ${formatDateTimeMY(s.locked_until)} (${s.failed_pin_attempts || 0} percubaan gagal).`;
    }

    document.getElementById('staff-modal').classList.add('open');
}

function closeStaffModal() {
    document.getElementById('staff-modal').classList.remove('open');
    pendingPinHash = null;
}

function handleStaffOverlay(e) {
    if (e.target === document.getElementById('staff-modal')) closeStaffModal();
}

// ─── PIN generation (client-side, CSPRNG — see staff-pin-pure.js) ─────────────
async function generateNewPin() {
    const { pin, pin_hash } = await generatePinAndHash();
    pendingPinHash = pin_hash;
    document.getElementById('pin-reveal-value').textContent = pin;
    document.getElementById('pin-reveal-box').style.display = '';
    document.getElementById('pin-status-text').textContent = 'PIN baharu dijana (belum disimpan).';
}

// Admin-typed PIN, as an alternative to generateNewPin() — same format
// constraint (6 digits) and same downstream pendingPinHash/save flow,
// just sourced from the admin's own input instead of a CSPRNG.
async function setManualPin() {
    const input = document.getElementById('manual-pin-input');
    const pin = input.value.trim();
    try {
        const { pin_hash } = await hashManualPin(pin);
        pendingPinHash = pin_hash;
        document.getElementById('pin-reveal-value').textContent = pin;
        document.getElementById('pin-reveal-box').style.display = '';
        document.getElementById('pin-status-text').textContent = 'PIN ditetapkan secara manual (belum disimpan).';
        input.value = '';
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── Clear a lockout without generating a new PIN ─────────────────────────────
async function clearLockout() {
    const id = document.getElementById('edit-id').value.trim();
    if (!id) return;
    const s = allStaff.find(x => x.id === id);

    try {
        await staffApi('clear-lockout', { method: 'POST', body: { id } });
    } catch (e) {
        showToast('Gagal membuka kunci: ' + e.message, 'error');
        return;
    }

    showToast('Kunci akaun dibuka', 'success');
    await neonLog('staff_lockout_cleared', s?.full_name || '(tidak diketahui)', 'Kunci PIN dibuka oleh admin.', 'staff_activity_log');
    document.getElementById('lock-status-group').style.display = 'none';
    await loadStaff();
}

// ─── Save staff ───────────────────────────────────────────────────────────────
function buildStaffDiffText(before, after) {
    const parts = [];
    if (before.full_name !== after.full_name) {
        parts.push(`Nama Penuh: "${before.full_name}" → "${after.full_name}"`);
    }
    if ((before.phone || null) !== (after.phone || null)) {
        parts.push(`Telefon: ${before.phone ? `"${before.phone}"` : 'Tiada'} → ${after.phone ? `"${after.phone}"` : 'Tiada'}`);
    }
    if ((before.email || null) !== (after.email || null)) {
        parts.push(`Emel: ${before.email ? `"${before.email}"` : 'Tiada'} → ${after.email ? `"${after.email}"` : 'Tiada'}`);
    }
    if (before.enabled !== after.enabled) {
        parts.push(after.enabled ? 'Diaktifkan' : 'Dinyahaktifkan');
    }
    // PIN regeneration is logged separately as its own staff_pin_reset
    // action (see saveStaff()) — a security-relevant event worth being
    // independently filterable in userlog.html, not buried inside a
    // combined staff_update diff string the way ustaz.js folds its own
    // poster changes in.
    return parts.length ? parts.join('; ') : null;
}

async function saveStaff() {
    const id        = document.getElementById('edit-id').value.trim();
    const fullName  = document.getElementById('edit-fullname').value.trim();
    const phone     = document.getElementById('edit-phone').value.trim();
    const email     = document.getElementById('edit-email').value.trim();
    const enabled   = document.getElementById('edit-enabled').checked;

    if (!fullName) {
        showToast('Nama penuh diperlukan', 'error');
        document.getElementById('edit-fullname').focus();
        return;
    }
    if (!id && !pendingPinHash) {
        showToast('Jana PIN terlebih dahulu sebelum menyimpan staf baharu.', 'error');
        return;
    }

    const saveBtn = document.getElementById('staff-save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const before = id ? allStaff.find(s => s.id === id) : null;

    const row = {
        id: id || undefined,
        full_name:  fullName,
        phone:      phone || null,
        email:      email || null,
        enabled,
    };
    if (pendingPinHash) {
        row.pin_hash = pendingPinHash;
    }

    try {
        await staffApi('save', { method: 'POST', body: { row } });
    } catch (e) {
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        showToast('Gagal menyimpan: ' + e.message, 'error');
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast(id ? 'Staf dikemaskini' : 'Staf berjaya ditambah', 'success');
    if (id) {
        const after = { full_name: fullName, phone: phone || null, email: email || null, enabled };
        const diff = buildStaffDiffText(before, after);
        if (diff) await neonLog('staff_update', fullName, diff, 'staff_activity_log');
        if (pendingPinHash) await neonLog('staff_pin_reset', fullName, 'PIN dijana semula oleh admin.', 'staff_activity_log');
    } else {
        await neonLog('staff_create', fullName, 'Staf baharu ditambah.', 'staff_activity_log');
    }
    pendingPinHash = null;
    closeStaffModal();
    await loadStaff();
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

async function confirmDelete() {
    if (!deletingId) return;

    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled  = true;
    btn.textContent = 'Memadam...';

    const target = allStaff.find(s => s.id === deletingId);
    try {
        await staffApi('delete', { method: 'POST', body: { id: deletingId } });
    } catch (e) {
        btn.disabled  = false;
        btn.textContent = 'Padam';
        showToast('Gagal memadam: ' + e.message, 'error');
        return;
    }

    btn.disabled  = false;
    btn.textContent = 'Padam';

    showToast('Staf berjaya dipadam', 'success');
    await neonLog('staff_delete', target?.full_name || '(tidak diketahui)', `Staf "${target?.full_name || ''}" dipadam.`, 'staff_activity_log');
    closeDeleteModal();
    await loadStaff();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
init();
