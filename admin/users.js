let allUsers = [];
let pendingDeleteEmail = null;

(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (currentAdmin.role !== 'super_admin') {
        showToast('Akses ditolak. Halaman ini hanya untuk Super Admin.', 'error');
        setTimeout(() => window.location.replace(defaultLandingPageFor(currentAdmin) || '/admin/index.html'), 2000);
        return;
    }
    await loadUsers();
})();

async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="state-cell">Memuatkan...</td></tr>';

    let out;
    try {
        out = await authApi('users');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-cell">Ralat: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }
    allUsers = out.users || [];
    renderUsers();
}

function renderUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!allUsers.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="state-cell">Tiada pengguna.</td></tr>';
        return;
    }

    tbody.innerHTML = allUsers.map(u => {
        const isSelf = u.email === currentAdmin.email;
        const roleLabel = u.role === 'super_admin'
            ? `<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:var(--primary);color:#fff">Super Admin</span>`
            : u.role === 'viewer'
            ? `<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:#dbeafe;color:#1d4ed8">Viewer</span>`
            : `<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:var(--border);color:var(--text)">Editor</span>`;

        let permLabel = '—';
        if (u.role === 'super_admin') {
            permLabel = '<em style="color:var(--text-muted)">Semua</em>';
        } else {
            const perms = u.permissions || {};
            const active = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
            permLabel = active.length ? escapeHtml(active.join(', ')) : '<em style="color:var(--text-muted)">Tiada</em>';
        }

        return `<tr>
            <td data-label="E-mel"><span>${escapeHtml(u.email)}${isSelf ? ' <span style="font-size:0.7rem;color:var(--text-muted)">(anda)</span>' : ''}</span></td>
            <td data-label="Nama">${escapeHtml(u.name || '—')}</td>
            <td data-label="Peranan">${roleLabel}</td>
            <td data-label="Kebenaran" style="font-size:0.85rem">${permLabel}</td>
            <td data-label="">
                <div class="actions">
                    <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${escapeHtml(u.email)}')">${ACTION_ICONS.edit}</button>
                    ${!isSelf
                        ? `<button class="btn btn-danger btn-sm" title="Buang" aria-label="Buang" onclick="openDeleteModal('${escapeHtml(u.email)}')">${ACTION_ICONS.delete}</button>`
                        : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function openAddModal() {
    document.getElementById('user-modal-title').textContent = 'Tambah Pengguna';
    document.getElementById('edit-original-email').value = '';
    document.getElementById('edit-email').value = '';
    document.getElementById('edit-email').disabled = false;
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-role').value = 'editor';
    document.getElementById('perm-kuliah').checked = true;
    document.getElementById('perm-infaq').checked = false;
    document.getElementById('perm-news').checked = false;
    document.getElementById('perm-staff').checked = false;
    document.getElementById('perm-khutbah').checked = false;
    document.getElementById('perm-kalendar').checked = false;
    togglePermFields();
    document.getElementById('user-modal').classList.add('open');
}

function openEditModal(email) {
    const u = allUsers.find(x => x.email === email);
    if (!u) return;
    document.getElementById('user-modal-title').textContent = 'Edit Pengguna';
    document.getElementById('edit-original-email').value = email;
    document.getElementById('edit-email').value = email;
    document.getElementById('edit-email').disabled = true;
    document.getElementById('edit-name').value = u.name || '';
    document.getElementById('edit-role').value = u.role;
    document.getElementById('perm-kuliah').checked = u.permissions?.kuliah !== false;
    document.getElementById('perm-infaq').checked = u.permissions?.infaq === true;
    document.getElementById('perm-news').checked = u.permissions?.news === true;
    document.getElementById('perm-staff').checked = u.permissions?.staff === true;
    document.getElementById('perm-khutbah').checked = u.permissions?.khutbah === true;
    document.getElementById('perm-kalendar').checked = u.permissions?.kalendar === true;
    togglePermFields();
    document.getElementById('user-modal').classList.add('open');
}

function closeUserModal() {
    document.getElementById('user-modal').classList.remove('open');
}

function handleUserOverlay(e) {
    if (e.target.id === 'user-modal') closeUserModal();
}

function togglePermFields() {
    const role = document.getElementById('edit-role').value;
    const permGroup = document.getElementById('perm-group');
    const hint = document.getElementById('role-hint');
    if (role === 'super_admin') {
        permGroup.style.display = 'none';
        hint.textContent = 'Super Admin boleh mengurus pengguna dan akses penuh ke semua modul.';
    } else if (role === 'viewer') {
        permGroup.style.display = '';
        hint.textContent = 'Viewer boleh melihat data mengikut modul yang dibenarkan, tetapi tidak boleh menambah, mengedit, memadam atau menerbitkan.';
    } else {
        permGroup.style.display = '';
        hint.textContent = 'Editor boleh mengedit jadual dan data penceramah mengikut modul yang dibenarkan.';
    }
}

function roleLabelMY(role) {
    if (role === 'super_admin') return 'Super Admin';
    if (role === 'viewer') return 'Viewer';
    return 'Editor';
}

// Compares the pre-write admins row against the values about to be saved and
// returns a human-readable diff string, or null if nothing actually changed.
function buildUserDiffText(before, after) {
    const parts = [];
    if ((before.name || null) !== (after.name || null)) {
        parts.push(`Nama: ${before.name || '—'} → ${after.name || '—'}`);
    }
    if (before.role !== after.role) {
        parts.push(`Peranan: ${roleLabelMY(before.role)} → ${roleLabelMY(after.role)}`);
    }
    const permText = p => p.role === 'super_admin'
        ? 'Semua'
        : (Object.entries(p.permissions || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'Tiada');
    const beforePerm = permText(before), afterPerm = permText(after);
    if (beforePerm !== afterPerm) {
        parts.push(`Kebenaran: ${beforePerm} → ${afterPerm}`);
    }
    return parts.length ? parts.join('; ') : null;
}

async function saveUser() {
    const originalEmail = document.getElementById('edit-original-email').value;
    const email = document.getElementById('edit-email').value.trim().toLowerCase();
    const name  = document.getElementById('edit-name').value.trim();
    const role  = document.getElementById('edit-role').value;
    const perms = {
        kuliah: document.getElementById('perm-kuliah').checked,
        infaq:  document.getElementById('perm-infaq').checked,
        news:   document.getElementById('perm-news').checked,
        staff:  document.getElementById('perm-staff').checked,
        khutbah: document.getElementById('perm-khutbah').checked,
        kalendar: document.getElementById('perm-kalendar').checked,
    };
    const before = originalEmail ? allUsers.find(u => u.email === originalEmail) : null;

    if (!email) { showToast('Sila masukkan e-mel.', 'error'); return; }

    const btn = document.getElementById('user-save-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    try {
        await authApi('save-user', {
            method: 'POST',
            body: {
                user: {
                    email,
                    name: name || null,
                    role,
                    permissions: role === 'super_admin' ? {} : perms,
                    originalEmail: originalEmail || undefined,
                },
            },
        });
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Simpan';
        showToast('Ralat: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Simpan';

    closeUserModal();
    showToast(originalEmail ? 'Pengguna dikemaskini.' : 'Pengguna ditambah.', 'success');
    if (originalEmail) {
        const after = { name: name || null, role, permissions: role === 'super_admin' ? {} : perms };
        const diff = buildUserDiffText(before, after);
        if (diff) await neonLog('admin_update', email, diff);
    } else {
        await neonLog('admin_create', email, `Pengguna baharu ditambah (${roleLabelMY(role)}).`);
    }
    await loadUsers();
}

// ─── Remove modal ─────────────────────────────────────────────────────────────

function openDeleteModal(email) {
    pendingDeleteEmail = email;
    document.getElementById('delete-user-email').textContent = email;
    document.getElementById('delete-user-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-user-modal').classList.remove('open');
    pendingDeleteEmail = null;
}

function handleDeleteOverlay(e) {
    if (e.target.id === 'delete-user-modal') closeDeleteModal();
}

async function confirmDeleteUser() {
    if (!pendingDeleteEmail) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true; btn.textContent = 'Membuang...';

    const target = allUsers.find(u => u.email === pendingDeleteEmail);
    try {
        await authApi('delete-user', { method: 'POST', body: { email: pendingDeleteEmail } });
    } catch (e) {
        btn.disabled = false; btn.textContent = 'Buang';
        showToast('Ralat: ' + e.message, 'error');
        return;
    }

    btn.disabled = false; btn.textContent = 'Buang';
    const deletedEmail = pendingDeleteEmail;
    closeDeleteModal();

    showToast('Pengguna dibuang.', 'success');
    await neonLog('admin_delete', deletedEmail, `Pengguna "${target?.name || deletedEmail}" (${roleLabelMY(target?.role)}) dibuang.`);
    await loadUsers();
}
