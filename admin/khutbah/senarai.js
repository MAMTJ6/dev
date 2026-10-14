// admin/khutbah/senarai.js — weekly history table + manual override editor.
// Automation-first: rows are written by api/publish-khutbah.js (Mon-9am cron
// or "Jana & Terbitkan"). Manual edits here set manual_override=true, which
// locks the row — the cron writes skipped_locked and leaves it untouched
// until unlocked. This explicit flag replaces the old Sheet formula/value
// distinction (see khutbah/DEV_NOTES.md).

let allWeeks = [];

(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireKhutbahAccess())) return;
    if (!canWriteModule('khutbah')) {
        const btn = document.getElementById('publish-khutbah-btn');
        if (btn) btn.style.display = 'none';
        const saveBtn = document.getElementById('save-settings-btn');
        if (saveBtn) saveBtn.style.display = 'none';
    }
    await Promise.all([loadWeeks(), loadAlertSettings(), loadLastPublishedKhutbahNote('last-published-note')]);
})();

async function loadWeeks() {
    const tbody = document.getElementById('khutbah-tbody');
    let out;
    try {
        out = await khutbahApi('list-weeks');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-cell">Ralat memuatkan: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }
    allWeeks = out.rows || [];
    if (!allWeeks.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-cell">Tiada data — klik "Jana & Terbitkan" untuk janaan pertama.</td></tr>`;
        return;
    }
    tbody.innerHTML = allWeeks.map((r, i) => `
        <tr>
            <td data-label="#">${i + 1}</td>
            <td data-label="Jumaat">${escapeHtml(r.friday_date || '')}</td>
            <td data-label="Siri">${escapeHtml(r.siri_text || '')}</td>
            <td data-label="Tajuk">${escapeHtml(r.title || '—')}</td>
            <td data-label="Status">${statusBadge(r.scrape_status)}</td>
            <td data-label="Kunci">${r.manual_override ? '🔒' : ''}</td>
            <td data-label="Tindakan">
                <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal('${r.id}')">${ACTION_ICONS.edit}</button>
                ${r.manual_override
                    ? `<button class="btn btn-ghost btn-sm" onclick="toggleLock('${r.id}', false)">Buka Kunci</button>`
                    : `<button class="btn btn-ghost btn-sm" onclick="toggleLock('${r.id}', true)">Kunci</button>`}
            </td>
        </tr>`).join('');
}

function statusBadge(status) {
    const cls = status === 'ok' ? 'news-status-active'
        : status === 'skipped_locked' ? 'news-status-upcoming'
        : status ? 'news-status-expired' : '';
    return `<span class="news-status-badge ${cls}">${escapeHtml(status || '—')}</span>`;
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

function openEditModal(id) {
    const r = allWeeks.find(w => w.id === id);
    if (!r) return;
    document.getElementById('edit-id').value = r.id;
    document.getElementById('edit-friday').value = r.friday_date || '';
    document.getElementById('edit-title').value = r.title || '';
    document.getElementById('edit-date-text').value = r.date_text || '';
    document.getElementById('edit-main-text').value = r.main_text || '';
    document.getElementById('edit-url').value = r.source_url || '';
    document.getElementById('edit-override').checked = !!r.manual_override;
    document.getElementById('test-url-note').textContent = '';
    document.getElementById('khutbah-modal-title').textContent = `Kemaskini — ${r.friday_date || ''}`;
    document.getElementById('khutbah-modal').classList.add('open');
}

function closeKhutbahModal() {
    document.getElementById('khutbah-modal').classList.remove('open');
}

function handleKhutbahOverlay(e) {
    if (e.target.id === 'khutbah-modal') closeKhutbahModal();
}

// ─── URL tester (preview-only) ───────────────────────────────────────────
// Paste a corrected mufti URL → server-side fetch via api/khutbah-test-url.js
// (mufti CORS blocks direct browser fetch) → fill tajuk/tarikh WITHOUT
// saving. The admin reviews, then Simpan sets manual_override=true.
// Nothing here writes DB or publishes JSON.
async function testKhutbahUrl() {
    const url = document.getElementById('edit-url').value.trim();
    const note = document.getElementById('test-url-note');
    const btn = document.getElementById('test-url-btn');
    if (!url) { note.textContent = 'Tampal pautan mufti dahulu.'; return; }
    btn.disabled = true;
    note.textContent = 'Menguji pautan...';
    try {
        const res = await fetch('/api/khutbah-test-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
            window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
            return;
        }
        if (!res.ok || json.success === false) {
            note.textContent = json.error || `Gagal menguji pautan (HTTP ${res.status}).`;
            return;
        }
        document.getElementById('edit-title').value = json.title || '';
        document.getElementById('edit-date-text').value = json.date_text || '';
        document.getElementById('edit-override').checked = true;
        const flag = (json.dateMatched !== 'primary' || json.titleMatched !== 'primary')
            ? ` (tarikh:${json.dateMatched} tajuk:${json.titleMatched})` : '';
        note.textContent = `Diambil dari halaman${flag} — semak, kemudian Simpan.`;
    } catch (e) {
        console.error('testKhutbahUrl failed:', e);
        note.textContent = `Gagal menguji pautan: ${e.message}`;
    } finally {
        btn.disabled = false;
    }
}

async function saveKhutbah() {
    const id = document.getElementById('edit-id').value;
    const friday = document.getElementById('edit-friday').value;
    const before = allWeeks.find(w => w.id === id);
    const titleVal = document.getElementById('edit-title').value.trim() || null;
    const row = {
        id,
        title: titleVal,
        date_text: document.getElementById('edit-date-text').value.trim() || null,
        main_text: document.getElementById('edit-main-text').value.trim() || null,
        source_url: document.getElementById('edit-url').value.trim(),
        manual_override: document.getElementById('edit-override').checked,
    };
    if (!row.source_url) { showToast('Pautan sumber diperlukan.', 'error'); return; }
    try {
        await khutbahApi('save-week', { method: 'POST', body: { row } });
    } catch (e) {
        showToast(`Gagal menyimpan: ${e.message}`, 'error');
        return;
    }
    const wasLocked = !!before?.manual_override;
    if (row.manual_override && !wasLocked) {
        neonLog('khutbah_lock', friday, 'Dikunci manual dari senarai', 'khutbah_activity_log');
    } else if (!row.manual_override && wasLocked) {
        neonLog('khutbah_unlock', friday, 'Dibuka kunci manual dari senarai', 'khutbah_activity_log');
    }
    neonLog('khutbah_manual_update', friday, buildDiffText(before, row), 'khutbah_activity_log');
    showToast('Disimpan.', 'success');
    closeKhutbahModal();
    await loadWeeks();
}

function buildDiffText(before, after) {
    if (!before) return 'Kemaskini manual';
    const parts = [];
    for (const k of ['title', 'date_text', 'main_text', 'source_url']) {
        if ((before[k] || '') !== (after[k] || '')) parts.push(`${k}: "${before[k] || '—'}" → "${after[k] || '—'}"`);
    }
    if (!!before.manual_override !== !!after.manual_override) {
        parts.push(after.manual_override ? 'dikunci' : 'dibuka kunci');
    }
    return parts.join('; ') || 'Tiada perubahan';
}

async function toggleLock(id, lock) {
    const r = allWeeks.find(w => w.id === id);
    if (!r) return;
    try {
        await khutbahApi('toggle-lock', { method: 'POST', body: { id, lock } });
    } catch (e) {
        showToast(`Gagal: ${e.message}`, 'error');
        return;
    }
    neonLog(lock ? 'khutbah_lock' : 'khutbah_unlock', r.friday_date || '',
        lock ? 'Dikunci manual dari senarai' : 'Dibuka kunci manual dari senarai', 'khutbah_activity_log');
    showToast(lock ? 'Dikunci — cron akan langkau minggu ini.' : 'Dibuka kunci.', 'success');
    await loadWeeks();
}

// ─── Publish + settings ──────────────────────────────────────────────────────

async function onPublishClick() {
    const json = await publishKhutbah('publish-khutbah-btn');
    if (json) {
        await loadWeeks();
        await loadLastPublishedKhutbahNote('last-published-note');
    }
}

async function loadAlertSettings() {
    const s = await getKhutbahSettings(['alert_emails', 'alert_from', 'last_alert_at', 'last_alert_reason']);
    document.getElementById('set-alert-emails').value = s.alert_emails || '';
    document.getElementById('set-alert-from').value = s.alert_from || '';
    const note = document.getElementById('last-alert-note');
    if (s.last_alert_at) {
        note.textContent = `Amaran terakhir: ${formatDateTimeMY(s.last_alert_at)} (${s.last_alert_reason || ''})`;
    } else {
        note.textContent = 'Tiada amaran dihantar lagi.';
    }
}

async function saveAlertSettings() {
    const emails = document.getElementById('set-alert-emails').value.trim();
    const from = document.getElementById('set-alert-from').value.trim();
    try {
        await saveKhutbahSetting('alert_emails', emails);
        await saveKhutbahSetting('alert_from', from);
    } catch (e) {
        showToast(`Gagal menyimpan tetapan: ${e.message}`, 'error');
        return;
    }
    neonLog('khutbah_settings_update', 'alert_emails', `alert_emails → "${emails}"`, 'khutbah_activity_log');
    showToast('Tetapan disimpan.', 'success');
}
