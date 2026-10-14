// Admin editor for calendar/hijri/data/events.json — same browser pattern as
// admin/khutbah/senarai.js (cookie-auth read gate, GitHub publish via API).
// Events are kept in-memory, sorted by eventDate on render + publish.

let calEvents = [];

// Canonical Hijri month names (web pages use Muharam/Ramadan spelling —
// generate_ics.py uses Muharram/Ramadhan; accept both, warn on neither-match).
const HIJRI_MONTHS_KNOWN = ['muharam', 'muharram', 'safar', 'rabiulawal', 'rabiulakhir',
    'jamadilawal', 'jamadilakhir', 'rejab', 'syaaban', 'ramadan', 'ramadhan',
    'syawal', 'zulkaedah', 'zulhijah', 'zulhijjah'];

function hijriMonthOk(hijriDate) {
    const lower = String(hijriDate || '').toLowerCase();
    return HIJRI_MONTHS_KNOWN.some(m => lower.includes(m));
}

function lastEventDaysLeft() {
    const dated = calEvents.filter(e => e.eventDate);
    if (!dated.length) return null;
    const last = dated.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate)).pop();
    return Math.ceil((new Date(last.eventDate + 'T00:00:00') - Date.now()) / 86400000);
}

(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireCalendarAccess())) return;
    applyWriteGate();
    await loadEvents();
    await loadLastPublishedCalendarNote('last-published-note');
})();

function applyWriteGate() {
    const canWrite = canWriteModule('kalendar');
    const pub = document.getElementById('publish-calendar-btn');
    const add = document.getElementById('add-event-btn');
    if (pub && !canWrite) pub.style.display = 'none';
    if (add && !canWrite) add.style.display = 'none';
}

async function loadEvents() {
    const tbody = document.getElementById('calendar-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Memuatkan...</td></tr>';
    try {
        // Absolute path — cleanUrls serves this page at bare /admin/calendar
        // (no trailing slash), so a relative fetch would resolve one level up.
        const res = await fetch(`/calendar/hijri/data/events.json?v=${Date.now()}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        calEvents = (data.events || []).slice().sort((a, b) =>
            new Date(a.eventDate) - new Date(b.eventDate));
        renderRows();
        const daysLeft = lastEventDaysLeft();
        if (daysLeft !== null && daysLeft < 30) {
            showToast(daysLeft < 0
                ? 'Data tamat — kemas kini tahunan diperlukan.'
                : `Tinggal ${daysLeft} hari sehingga acara terakhir — sediakan kemas kini tahunan.`, 'error', 8000);
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="state-cell">Ralat: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// Countdown helpers — same buckets as calendar/hijri/tarikh-penting/app.js:
// dayDiff > 0 → "X hari lagi", === 0 → "Hari Ini!", < 0 → "Telah lepas".
function calDayDiff(eventDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((new Date(eventDate + 'T00:00:00') - today) / 86400000);
}

function countdownBadgeHtml(dayDiff) {
    if (dayDiff > 0) return `<span class="news-status-badge news-status-upcoming">${dayDiff} hari lagi</span>`;
    if (dayDiff === 0) return `<span class="news-status-badge news-status-active">Hari Ini!</span>`;
    return `<span class="news-status-badge news-status-expired">Telah lepas</span>`;
}

// "Peristiwa Terdekat" preview — mirrors the public card, computed live from
// the in-memory (possibly unsaved) calEvents so edits can be checked before
// Simpan & Terbitkan.
function renderNextCard() {
    const card = document.getElementById('calendar-next-card');
    if (!card) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = calEvents
        .filter(e => e.eventDate && new Date(e.eventDate + 'T00:00:00') >= today)
        .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))[0];
    if (!next) { card.style.display = 'none'; return; }
    card.style.display = '';
    document.getElementById('calendar-next-name').textContent = next.eventName || '';
    document.getElementById('calendar-next-date').textContent =
        `${next.hijriDate || ''} / ${formatDateMY(next.eventDate)}`;
    document.getElementById('calendar-next-countdown').innerHTML =
        countdownBadgeHtml(calDayDiff(next.eventDate));
}

function renderRows() {
    renderNextCard();
    const tbody = document.getElementById('calendar-tbody');
    const canWrite = canWriteModule('kalendar');
    if (!calEvents.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="state-cell">Tiada acara.</td></tr>';
        return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDate = (calEvents
        .filter(e => e.eventDate && new Date(e.eventDate + 'T00:00:00') >= today)
        .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))[0] || {}).eventDate;
    tbody.innerHTML = calEvents.map((e, i) => {
    const dayDiff = e.eventDate ? calDayDiff(e.eventDate) : null;
    const isNext = e.eventDate && e.eventDate === nextDate;
    return `<tr${isNext ? ' style="background:var(--primary-50, #ecfdf5)"' : ''}${dayDiff !== null && dayDiff < 0 ? ' style="opacity:0.55"' : ''}>
        <td data-label="#">${i + 1}</td>
        <td data-label="Nama Peristiwa">${escapeHtml(e.eventName || '')}</td>
        <td data-label="Tarikh Hijrah">${escapeHtml(e.hijriDate || '')}</td>
        <td data-label="Tarikh Masihi">${e.eventDate ? escapeHtml(formatDateMY(e.eventDate)) : ''}</td>
        <td data-label="Kira Detik">${dayDiff === null ? '—' : countdownBadgeHtml(dayDiff)}</td>
        <td data-label="">${canWrite
            ? `<div class="actions">
                <button class="btn btn-ghost btn-sm" title="Edit" aria-label="Edit" onclick="openEditModal(${i})">${ACTION_ICONS.edit}</button>
                <button class="btn btn-danger btn-sm" title="Padam" aria-label="Padam" onclick="deleteRow(${i})">${ACTION_ICONS.delete}</button>
               </div>`
            : '<span class="page-hint">—</span>'}</td>
    </tr>`;}).join('');
}

function addRow() {
    document.getElementById('calendar-modal-title').textContent = 'Tambah Acara';
    document.getElementById('edit-index').value = '';
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-hijri').value = '';
    document.getElementById('edit-date').value = '';
    document.getElementById('calendar-modal').classList.add('open');
}

function openEditModal(i) {
    const e = calEvents[i];
    if (!e) return;
    document.getElementById('calendar-modal-title').textContent = 'Edit Acara';
    document.getElementById('edit-index').value = String(i);
    document.getElementById('edit-name').value = e.eventName || '';
    document.getElementById('edit-hijri').value = e.hijriDate || '';
    document.getElementById('edit-date').value = e.eventDate || '';
    document.getElementById('calendar-modal').classList.add('open');
}

function closeCalendarModal() {
    document.getElementById('calendar-modal').classList.remove('open');
}

function handleCalendarOverlay(e) {
    if (e.target.id === 'calendar-modal') closeCalendarModal();
}

function saveRow() {
    const idx = document.getElementById('edit-index').value;
    const row = {
        eventName: document.getElementById('edit-name').value.trim(),
        hijriDate: document.getElementById('edit-hijri').value.trim(),
        eventDate: document.getElementById('edit-date').value,
    };
    if (!row.eventName || !row.eventDate || !row.hijriDate) {
        showToast('Lengkapkan ketiga-tiga medan.', 'error');
        return;
    }
    if (!hijriMonthOk(row.hijriDate)) {
        showToast('Ejaan bulan Hijrah tidak dikenali — semak (cth: Muharam, Ramadan, Syawal).', 'error');
        return;
    }
    if (idx === '') calEvents.push(row);
    else calEvents[Number(idx)] = row;
    calEvents.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
    closeCalendarModal();
    renderRows();
}

function deleteRow(i) {
    if (!confirm(`Padam "${calEvents[i]?.eventName || ''}"?`)) return;
    calEvents.splice(i, 1);
    renderRows();
}

async function onSavePublish() {
    const daysLeft = lastEventDaysLeft();
    if (daysLeft !== null && daysLeft < 30 && !confirm(
        daysLeft < 0 ? 'Data semasa sudah tamat. Terbitkan juga?'
            : `Tinggal ${daysLeft} hari sehingga acara terakhir. Terbitkan juga?`)) return;
    const json = await publishCalendarEvents(calEvents, 'publish-calendar-btn');
    if (json) await loadLastPublishedCalendarNote('last-published-note');
}
