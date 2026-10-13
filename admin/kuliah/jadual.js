// ─── State ────────────────────────────────────────────────────────────────────
let currentYear, currentMonth;
let scheduleMap = {};   // dateStr → { date, cuti_umum, subuh_ustaz_id, maghrib_ustaz_id, subuh, maghrib, subuh_pending, maghrib_pending, subuh_khas, maghrib_khas, subuh_ditangguhkan, maghrib_ditangguhkan }
let ustazList   = [];   // full list from DB
let ustazMap    = {};   // id → ustaz object
let editingDate = null; // date string currently open in modal

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireModuleAccess('kuliah'))) return;

    const now = new Date();
    currentYear  = now.getFullYear();
    currentMonth = now.getMonth() + 1;

    await loadMonth();
}

// ─── Load month data ──────────────────────────────────────────────────────────
async function loadMonth() {
    const labelEl   = document.getElementById('month-label');
    const publishBtn = document.getElementById('publish-btn');
    const label     = monthLabel(currentYear, currentMonth);

    labelEl.textContent    = label;
    publishBtn.textContent = `Terbitkan ${label}`;
    await updateScheduleActions();

    const src = getPrevMonthOf(currentYear, currentMonth);
    document.getElementById('duplicate-month-label').textContent = `Salin Data ${monthLabel(src.year, src.month)}`;

    document.getElementById('calendar-body').innerHTML =
        '<tr><td colspan="7" class="state-cell">Memuatkan...</td></tr>';

    // Salin Data / Kosongkan Bulan Ini — both write actions, hidden as a
    // group for a viewer/under-permissioned editor (mirrors the write-gate
    // pattern used everywhere else, see canWriteModule() in app.js).
    document.getElementById('month-actions').style.display = canWriteModule('kuliah') ? '' : 'none';

    // Load ustaz list + this month's schedule rows in one call (Neon).
    const padMonth = String(currentMonth).padStart(2, '0');
    let ustaz, rows;
    try {
        const out = await kuliahApi('schedule', { params: { month: `${currentYear}-${padMonth}` } });
        ustaz = out.ustaz;
        rows = out.rows;
    } catch (e) {
        showToast('Gagal memuatkan jadual: ' + e.message, 'error');
        return;
    }
    // Client-side sort by short_name (same as ustaz.js) — never sort
    // short_name server-side (lexicographic "10" < "2", not numeric).
    ustazList = (ustaz || []).sort((a, b) =>
        a.short_name.localeCompare(b.short_name, undefined, { numeric: true, sensitivity: 'base' })
    );
    ustazMap  = Object.fromEntries(ustazList.map(u => [u.id, u]));

    // Build schedule map with ustaz objects resolved
    scheduleMap = {};
    (rows || []).forEach(row => {
        scheduleMap[row.date] = {
            ...row,
            subuh:   row.subuh_ustaz_id   ? ustazMap[row.subuh_ustaz_id]   : null,
            maghrib: row.maghrib_ustaz_id ? ustazMap[row.maghrib_ustaz_id] : null,
        };
    });

    renderCalendar();
}

// ─── Render calendar grid ─────────────────────────────────────────────────────
function renderCalendar() {
    const tbody    = document.getElementById('calendar-body');
    const today    = todayString();
    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay(); // 0 = Ahad
    const total    = lastDayOfMonth(currentYear, currentMonth);
    const padMonth = String(currentMonth).padStart(2, '0');

    const weeks = Math.ceil((firstDay + total) / 7);
    let dayNum = 1;
    let html   = '';

    for (let week = 0; week < weeks; week++) {
        html += '<tr>';
        for (let col = 0; col < 7; col++) {
            const pos = week * 7 + col;
            if (pos < firstDay || dayNum > total) {
                html += '<td><div class="day-cell padding"></div></td>';
            } else {
                const dateStr    = `${currentYear}-${padMonth}-${String(dayNum).padStart(2, '0')}`;
                const row        = scheduleMap[dateStr];
                const isToday    = dateStr === today;
                const isWeekend  = col === 0 || col === 6;

                let cellClass = 'day-cell';
                if (isToday)   cellClass += ' is-today';
                if (isWeekend) cellClass += ' is-weekend';

                html += `<td><div class="${cellClass}" onclick="openModal('${dateStr}')">`;
                html += `<div class="day-num">${dayNum}</div>`;

                if (row?.cuti_umum) {
                    html += `<span class="holiday-tag">${escapeHtml(row.cuti_umum)}</span>`;
                }
                const subuhKhasCls   = row?.subuh_khas   ? ' khas' : '';
                const maghribKhasCls = row?.maghrib_khas ? ' khas' : '';
                const subuhTangguhCls   = row?.subuh_ditangguhkan   ? ' ditangguhkan' : '';
                const maghribTangguhCls = row?.maghrib_ditangguhkan ? ' ditangguhkan' : '';
                if (row?.subuh_pending) {
                    html += `<span class="session-tag pending${subuhKhasCls}${subuhTangguhCls}">S: Belum Ditetapkan</span>`;
                } else if (row?.subuh) {
                    const subuhClass = (isYasinEntry(row.subuh) ? 'session-tag yasin' : 'session-tag subuh') + subuhKhasCls + subuhTangguhCls;
                    const subuhLabel = row?.subuh_ditangguhkan ? `S: ${escapeHtml(row.subuh.short_name || row.subuh.full_name)} (Ditangguhkan)` : `S: ${escapeHtml(row.subuh.short_name || row.subuh.full_name)}`;
                    html += `<span class="${subuhClass}">${subuhLabel}</span>`;
                } else if (row) {
                    html += row?.subuh_ditangguhkan
                        ? `<span class="session-tag ditangguhkan">S: Ditangguhkan</span>`
                        : `<span class="session-tag empty">S: Tiada</span>`;
                }
                if (row?.maghrib_pending) {
                    html += `<span class="session-tag pending${maghribKhasCls}${maghribTangguhCls}">M: Belum Ditetapkan</span>`;
                } else if (row?.maghrib) {
                    const maghribClass = (isYasinEntry(row.maghrib) ? 'session-tag yasin' : 'session-tag maghrib') + maghribKhasCls + maghribTangguhCls;
                    const maghribLabel = row?.maghrib_ditangguhkan ? `M: ${escapeHtml(row.maghrib.short_name || row.maghrib.full_name)} (Ditangguhkan)` : `M: ${escapeHtml(row.maghrib.short_name || row.maghrib.full_name)}`;
                    html += `<span class="${maghribClass}">${maghribLabel}</span>`;
                } else if (row) {
                    html += row?.maghrib_ditangguhkan
                        ? `<span class="session-tag ditangguhkan">M: Ditangguhkan</span>`
                        : `<span class="session-tag empty">M: Tiada</span>`;
                }

                html += '</div></td>';
                dayNum++;
            }
        }
        html += '</tr>';
    }

    tbody.innerHTML = html;
    renderMobileDayList();
}

// ─── Mobile day list (phone view, ≤640px) ─────────────────────────────────────
function renderMobileDayList() {
    const list = document.getElementById('mobile-day-list');
    if (!list) return;

    const today    = todayString();
    const total    = lastDayOfMonth(currentYear, currentMonth);
    const padMonth = String(currentMonth).padStart(2, '0');
    let html = '';

    for (let d = 1; d <= total; d++) {
        const dateStr = `${currentYear}-${padMonth}-${String(d).padStart(2, '0')}`;
        const row     = scheduleMap[dateStr];
        const dow     = new Date(dateStr + 'T00:00:00').getDay();

        let cls = 'mobile-day-card';
        if (dateStr === today)  cls += ' is-today';
        if (row?.cuti_umum)     cls += ' has-holiday';

        const subuhPending   = !!row?.subuh_pending;
        const maghribPending = !!row?.maghrib_pending;
        const subuhDitangguhkan   = !!row?.subuh_ditangguhkan;
        const maghribDitangguhkan = !!row?.maghrib_ditangguhkan;
        const subuhName   = row?.subuh   ? escapeHtml(row.subuh.short_name   || row.subuh.full_name)   : null;
        const maghribName = row?.maghrib ? escapeHtml(row.maghrib.short_name || row.maghrib.full_name) : null;
        let subuhClass   = subuhPending   ? 'mdc-s mdc-pending' : (subuhName   ? (isYasinEntry(row.subuh)   ? 'mdc-s mdc-yasin' : 'mdc-s')   : (subuhDitangguhkan ? 'mdc-s mdc-ditangguhkan' : 'mdc-empty'));
        let maghribClass = maghribPending ? 'mdc-m mdc-pending' : (maghribName ? (isYasinEntry(row.maghrib) ? 'mdc-m mdc-yasin' : 'mdc-m')   : (maghribDitangguhkan ? 'mdc-m mdc-ditangguhkan' : 'mdc-empty'));
        if (row?.subuh_khas   && subuhClass.startsWith('mdc-s'))   subuhClass   += ' mdc-khas';
        if (row?.maghrib_khas && maghribClass.startsWith('mdc-m')) maghribClass += ' mdc-khas';
        if (subuhDitangguhkan   && subuhClass.startsWith('mdc-s'))   subuhClass   += ' mdc-ditangguhkan';
        if (maghribDitangguhkan && maghribClass.startsWith('mdc-m')) maghribClass += ' mdc-ditangguhkan';

        const subuhText   = subuhPending ? 'Belum Ditetapkan' : (subuhName ? (subuhDitangguhkan ? `${subuhName} (Ditangguhkan)` : subuhName) : (subuhDitangguhkan ? 'Ditangguhkan' : 'Tiada'));
        const maghribText = maghribPending ? 'Belum Ditetapkan' : (maghribName ? (maghribDitangguhkan ? `${maghribName} (Ditangguhkan)` : maghribName) : (maghribDitangguhkan ? 'Ditangguhkan' : 'Tiada'));
        html += `<div class="${cls}" onclick="openModal('${dateStr}')">
            <div class="mdc-date">${d}</div>
            <div class="mdc-day">${HARI_MALAY[dow]}</div>
            <div class="mdc-sessions">
                ${row?.cuti_umum ? `<span class="mdc-holiday">${escapeHtml(row.cuti_umum)}</span>` : ''}
                <span class="${subuhClass}">S: ${subuhText}</span>
                <span class="${maghribClass}">M: ${maghribText}</span>
            </div>
            <div class="mdc-arrow">›</div>
        </div>`;
    }

    list.innerHTML = html;
}

// ─── Schedule view / PDF export links (real current or next month only) ──────
async function updateScheduleActions() {
    const now       = new Date();
    const realYear  = now.getFullYear();
    const realMonth = now.getMonth() + 1;
    let nextYear = realYear, nextMonth = realMonth + 1;
    if (nextMonth > 12) { nextMonth = 1; nextYear++; }

    const container       = document.getElementById('schedule-actions');
    const note            = document.getElementById('schedule-actions-note');
    const futureMonthNote = document.getElementById('future-month-note');
    const scheduleLabel   = document.getElementById('schedule-actions-label');
    const viewBtn         = document.getElementById('view-schedule-btn');
    const pdfBtn          = document.getElementById('export-pdf-btn');
    const publishBtn      = document.getElementById('publish-btn');
    const publishHint     = document.getElementById('publish-hint');
    const lastPublishedNote = document.getElementById('last-published-note');

    const isRealCurrent = currentYear === realYear && currentMonth === realMonth;
    const isRealNext    = currentYear === nextYear  && currentMonth === nextMonth;

    const tagEl = document.getElementById('month-tag');
    if (tagEl) tagEl.textContent = isRealCurrent ? 'Bulan Ini' : (isRealNext ? 'Bulan Depan' : '');

    if (!isRealCurrent && !isRealNext) {
        container.style.display         = 'none';
        note.style.display              = 'none';
        futureMonthNote.style.display   = 'block';
        publishBtn.style.display        = 'none';
        publishHint.style.display       = 'none';
        lastPublishedNote.style.display = 'none';
        return;
    }
    futureMonthNote.style.display = 'none';
    publishBtn.style.display      = canWriteModule('kuliah') ? '' : 'none';
    publishHint.style.display     = canWriteModule('kuliah') ? '' : 'none';

    const query    = isRealNext ? '?bulan=depan' : '';
    const pdfQuery = isRealNext ? '?file=pdf&bulan=depan' : '?file=pdf';
    const label    = monthLabel(currentYear, currentMonth);
    viewBtn.href = `/kuliah/jadual/index.html${query}`;
    pdfBtn.href  = `/kuliah/jadual/index.html${pdfQuery}`;
    scheduleLabel.textContent = `Lihat Terbitan ${label}`;
    container.style.display = 'block';
    note.style.display      = 'block';

    await loadLastPublishedNote(label);
}

// Reads the most recent 'publish' activity_log row for this exact month label
// (e.g. "Julai 2026") and renders it, or "Belum diterbitkan" if none exists yet.
async function loadLastPublishedNote(label) {
    const el = document.getElementById('last-published-note');
    let row = null;
    try {
        const out = await kuliahApi('last-published', { params: { label } });
        row = out.row;
    } catch {
        row = null; // informational only, never block the page
    }

    if (!row) {
        el.textContent = 'Bulan ini belum pernah diterbitkan.';
    } else {
        const who = row.actor_name || row.actor_email;
        el.textContent = `Terakhir diterbitkan pada ${formatDateTimeMY(row.created_at)} (${formatRelativeMY(row.created_at)}) oleh ${who}`;
    }
    el.style.display = 'block';
}

// ─── Month actions dropdown ───────────────────────────────────────────────────
function toggleMonthActionsMenu(e) {
    e.stopPropagation();
    document.getElementById('month-actions-menu').classList.toggle('open');
}

function toggleScheduleActionsMenu(e) {
    e.stopPropagation();
    document.getElementById('schedule-actions-menu').classList.toggle('open');
}

document.addEventListener('click', () => {
    document.getElementById('month-actions-menu')?.classList.remove('open');
    document.getElementById('schedule-actions-menu')?.classList.remove('open');
});

function getPrevMonthOf(year, month) {
    let y = year, m = month - 1;
    if (m < 1) { m = 12; y--; }
    return { year: y, month: m };
}

function countFilledDays(map) {
    return Object.values(map).filter(row =>
        row.subuh_ustaz_id || row.maghrib_ustaz_id || row.subuh_pending || row.maghrib_pending || row.subuh_ditangguhkan || row.maghrib_ditangguhkan || row.cuti_umum
    ).length;
}

// ─── Duplicate month ──────────────────────────────────────────────────────────
function openDuplicateModal() {
    document.getElementById('month-actions-menu').classList.remove('open');

    const src         = getPrevMonthOf(currentYear, currentMonth);
    const srcLabel    = monthLabel(src.year, src.month);
    const targetLabel = monthLabel(currentYear, currentMonth);
    const filledCount = countFilledDays(scheduleMap);

    let text = `Salin semua data dari <strong>${escapeHtml(srcLabel)}</strong> ke <strong>${escapeHtml(targetLabel)}</strong>?`;
    if (filledCount > 0) {
        text += ` ${escapeHtml(targetLabel)} sudah mempunyai <strong>${filledCount}</strong> hari yang diisi — ia akan digantikan.`;
    }

    document.getElementById('duplicate-modal-text').innerHTML = text;
    document.getElementById('duplicate-modal').classList.add('open');
}

function closeDuplicateModal() {
    document.getElementById('duplicate-modal').classList.remove('open');
}

function handleDuplicateOverlay(e) {
    if (e.target === document.getElementById('duplicate-modal')) closeDuplicateModal();
}

async function confirmDuplicate() {
    const btn = document.getElementById('confirm-duplicate-btn');
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Menyalin...';

    const src         = getPrevMonthOf(currentYear, currentMonth);
    const padSrcMonth = String(src.month).padStart(2, '0');
    const srcStart    = `${src.year}-${padSrcMonth}-01`;
    const srcLastDay  = lastDayOfMonth(src.year, src.month);
    const srcEnd      = `${src.year}-${padSrcMonth}-${String(srcLastDay).padStart(2, '0')}`;

    // Salin Data copies ustaz assignments only — pending/khas/cuti_umum/
    // ditangguhkan are date-specific and intentionally NOT carried forward
    // (ditangguhkan is a per-date incident, same rationale as cuti_umum).
    let srcRows;
    try {
        const out = await kuliahApi('schedule', {
            params: { month: `${src.year}-${padSrcMonth}` },
        });
        srcRows = out.rows;
    } catch (e) {
        showToast('Gagal memuatkan data sumber: ' + e.message, 'error');
        btn.disabled   = false;
        btn.textContent = 'Salin & Gantikan';
        return;
    }

    const targetLastDay  = lastDayOfMonth(currentYear, currentMonth);
    const padTargetMonth = String(currentMonth).padStart(2, '0');

    const upserts = (srcRows || [])
        .filter(row => row.subuh_ustaz_id || row.maghrib_ustaz_id)
        .map(row => {
            const day = parseInt(row.date.split('-')[2], 10);
            if (day > targetLastDay) return null;
            return {
                date:             `${currentYear}-${padTargetMonth}-${String(day).padStart(2, '0')}`,
                subuh_ustaz_id:   row.subuh_ustaz_id,
                maghrib_ustaz_id: row.maghrib_ustaz_id,
                updated_at:       new Date().toISOString(),
            };
        })
        .filter(Boolean);

    if (upserts.length === 0) {
        showToast('Tiada data untuk disalin dari bulan sebelum ini.', 'info');
        btn.disabled   = false;
        btn.textContent = 'Salin & Gantikan';
        closeDuplicateModal();
        return;
    }

    try {
        await kuliahApi('upsert-days', { method: 'POST', body: { rows: upserts } });
    } catch (e) {
        showToast('Gagal menyalin data: ' + e.message, 'error');
        btn.disabled   = false;
        btn.textContent = 'Salin & Gantikan';
        return;
    }

    btn.disabled   = false;
    btn.textContent = 'Salin & Gantikan';

    showToast(`Berjaya menyalin ${upserts.length} hari.`, 'success');
    await neonLog(
        'schedule_duplicate',
        monthLabel(currentYear, currentMonth),
        `${upserts.length} hari disalin dari ${monthLabel(src.year, src.month)} ke ${monthLabel(currentYear, currentMonth)}.`
    );
    closeDuplicateModal();
    await loadMonth();
}

// ─── Clear month ──────────────────────────────────────────────────────────────
function openClearModal() {
    document.getElementById('month-actions-menu').classList.remove('open');

    const label       = monthLabel(currentYear, currentMonth);
    const filledCount = countFilledDays(scheduleMap);

    document.getElementById('clear-modal-text').innerHTML =
        `Padam semua jadual <strong>${escapeHtml(label)}</strong>? ` +
        `<strong>${filledCount}</strong> hari akan dikosongkan. Tindakan ini tidak boleh diundur.`;
    document.getElementById('clear-modal').classList.add('open');
}

function closeClearModal() {
    document.getElementById('clear-modal').classList.remove('open');
}

function handleClearOverlay(e) {
    if (e.target === document.getElementById('clear-modal')) closeClearModal();
}

async function confirmClear() {
    const btn = document.getElementById('confirm-clear-btn');
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Mengosongkan...';

    const padMonth  = String(currentMonth).padStart(2, '0');
    const startDate = `${currentYear}-${padMonth}-01`;
    const lastDay   = lastDayOfMonth(currentYear, currentMonth);
    const endDate   = `${currentYear}-${padMonth}-${String(lastDay).padStart(2, '0')}`;
    const filledCount = countFilledDays(scheduleMap);

    try {
        await kuliahApi('clear', { method: 'POST', body: { start: startDate, end: endDate } });
    } catch (e) {
        showToast('Gagal mengosongkan jadual: ' + e.message, 'error');
        btn.disabled   = false;
        btn.textContent = 'Kosongkan';
        return;
    }

    btn.disabled   = false;
    btn.textContent = 'Kosongkan';

    showToast('Jadual bulan ini telah dikosongkan.', 'success');
    await neonLog(
        'schedule_clear',
        monthLabel(currentYear, currentMonth),
        `${filledCount} hari dikosongkan (jadual dipadam).`
    );
    closeClearModal();
    await loadMonth();
}

// ─── Month navigation ─────────────────────────────────────────────────────────
function prevMonth() {
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    loadMonth();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    loadMonth();
}

// ─── Day editor modal ─────────────────────────────────────────────────────────
function openModal(dateStr) {
    editingDate = dateStr;
    const row   = scheduleMap[dateStr];

    document.getElementById('modal-date-label').textContent = formatDateMY(dateStr);

    // Cuti umum
    const hasCuti = !!(row?.cuti_umum);
    document.getElementById('cuti-check').checked  = hasCuti;
    document.getElementById('cuti-text').value     = row?.cuti_umum || '';
    document.getElementById('cuti-text').style.display = hasCuti ? 'block' : 'none';

    // Populate ustaz dropdowns — numbered by Nama Ringkas (suffix, so type-to-jump-by-name still works)
    const opts = '<option value="">— Tiada Kuliah —</option>' +
        ustazList.map((u, i) =>
            `<option value="${escapeHtml(u.id)}">${escapeHtml(u.short_name || u.full_name)} (${i})</option>`
        ).join('');

    const subuhSel   = document.getElementById('subuh-select');
    const maghribSel = document.getElementById('maghrib-select');
    subuhSel.innerHTML   = opts;
    maghribSel.innerHTML = opts;
    subuhSel.value   = row?.subuh_ustaz_id   || '';
    maghribSel.value = row?.maghrib_ustaz_id || '';

    // Belum Ditetapkan — mutually exclusive with picking an ustaz for that slot
    const subuhPendingCheck   = document.getElementById('subuh-pending-check');
    const maghribPendingCheck = document.getElementById('maghrib-pending-check');
    const subuhDitangguhkanCheck   = document.getElementById('subuh-ditangguhkan-check');
    const maghribDitangguhkanCheck = document.getElementById('maghrib-ditangguhkan-check');
    subuhPendingCheck.checked   = !!row?.subuh_pending;
    maghribPendingCheck.checked = !!row?.maghrib_pending;
    subuhDitangguhkanCheck.checked   = !!row?.subuh_ditangguhkan;
    maghribDitangguhkanCheck.checked = !!row?.maghrib_ditangguhkan;
    // Ditangguhkan MUST NOT combine with Pending (a pending slot has no
    // speaker to postpone) — enforce exclusion both directions, Khas untouched.
    subuhDitangguhkanCheck.disabled   = subuhPendingCheck.checked;
    maghribDitangguhkanCheck.disabled = maghribPendingCheck.checked;
    subuhPendingCheck.disabled   = subuhDitangguhkanCheck.checked;
    maghribPendingCheck.disabled = maghribDitangguhkanCheck.checked;
    subuhSel.disabled   = subuhPendingCheck.checked;
    maghribSel.disabled = maghribPendingCheck.checked;

    // Kuliah Khas — independent flag, NOT mutually exclusive with pending or
    // an assigned ustaz (a Khas lecture can have a confirmed speaker, or be
    // pending with no speaker decided yet), so the select is never disabled here.
    document.getElementById('subuh-khas-check').checked   = !!row?.subuh_khas;
    document.getElementById('maghrib-khas-check').checked = !!row?.maghrib_khas;

    // Viewer (or an under-permissioned editor): the modal still opens so
    // the day's assignment can be inspected, but every field becomes
    // read-only and Save is hidden — there's nothing here they're allowed
    // to write (see admin_can_write('kuliah') in setup.sql, the real
    // enforcement this mirrors).
    const readOnly = !canWriteModule('kuliah');
    document.getElementById('cuti-check').disabled           = readOnly;
    document.getElementById('cuti-text').disabled             = readOnly;
    document.getElementById('subuh-khas-check').disabled      = readOnly;
    document.getElementById('maghrib-khas-check').disabled    = readOnly;
    if (readOnly) {
        document.getElementById('subuh-pending-check').disabled   = true;
        document.getElementById('maghrib-pending-check').disabled = true;
        document.getElementById('subuh-ditangguhkan-check').disabled   = true;
        document.getElementById('maghrib-ditangguhkan-check').disabled = true;
    }
    // (when NOT read-only, the pending/ditangguhkan disabled states set above
    // are kept as-is — they encode the mutual exclusion, not permissions.)
    if (readOnly) { subuhSel.disabled = true; maghribSel.disabled = true; }
    document.getElementById('save-btn').style.display = readOnly ? 'none' : '';

    document.getElementById('day-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('day-modal').classList.remove('open');
    editingDate = null;
}

function handleOverlayClick(e) {
    if (e.target === document.getElementById('day-modal')) closeModal();
}

function toggleCutiField() {
    const checked = document.getElementById('cuti-check').checked;
    const field   = document.getElementById('cuti-text');
    field.style.display = checked ? 'block' : 'none';
    if (!checked) field.value = '';
}

function toggleSubuhPending() {
    const checked = document.getElementById('subuh-pending-check').checked;
    const sel      = document.getElementById('subuh-select');
    sel.disabled = checked;
    if (checked) sel.value = '';
    // Ditangguhkan MUST NOT combine with Pending — uncheck+disable it.
    const dt = document.getElementById('subuh-ditangguhkan-check');
    if (checked) dt.checked = false;
    dt.disabled = checked;
}

function toggleMaghribPending() {
    const checked = document.getElementById('maghrib-pending-check').checked;
    const sel      = document.getElementById('maghrib-select');
    sel.disabled = checked;
    if (checked) sel.value = '';
    const dt = document.getElementById('maghrib-ditangguhkan-check');
    if (checked) dt.checked = false;
    dt.disabled = checked;
}

function toggleSubuhDitangguhkan() {
    const checked = document.getElementById('subuh-ditangguhkan-check').checked;
    // Ditangguhkan keeps the assigned ustaz (same pattern as khas) — only
    // Pending is excluded, in both directions. Khas untouched.
    const pc = document.getElementById('subuh-pending-check');
    if (checked) {
        pc.checked = false;
        document.getElementById('subuh-select').disabled = false;
    }
    pc.disabled = checked;
}

function toggleMaghribDitangguhkan() {
    const checked = document.getElementById('maghrib-ditangguhkan-check').checked;
    const pc = document.getElementById('maghrib-pending-check');
    if (checked) {
        pc.checked = false;
        document.getElementById('maghrib-select').disabled = false;
    }
    pc.disabled = checked;
}

// ─── Save day ─────────────────────────────────────────────────────────────────
// Compares the pre-write scheduleMap row against the values about to be saved and
// returns a human-readable diff string, or null if nothing actually changed.
function buildDayDiffText(before, afterSubuhId, afterMaghribId, afterCuti, afterSubuhPending, afterMaghribPending, afterSubuhKhas, afterMaghribKhas, afterSubuhDitangguhkan, afterMaghribDitangguhkan) {
    const parts = [];
    const nameOf = u => u ? (u.short_name || u.full_name) : null;

    const beforeSubuh = before?.subuh_pending ? 'Belum Ditetapkan' : nameOf(before?.subuh);
    const afterSubuh   = afterSubuhPending ? 'Belum Ditetapkan' : (afterSubuhId ? nameOf(ustazMap[afterSubuhId]) : null);
    if ((beforeSubuh || null) !== (afterSubuh || null)) {
        parts.push(`Subuh: ${beforeSubuh || 'Tiada'} → ${afterSubuh || 'Tiada'}`);
    }

    const beforeMaghrib = before?.maghrib_pending ? 'Belum Ditetapkan' : nameOf(before?.maghrib);
    const afterMaghrib   = afterMaghribPending ? 'Belum Ditetapkan' : (afterMaghribId ? nameOf(ustazMap[afterMaghribId]) : null);
    if ((beforeMaghrib || null) !== (afterMaghrib || null)) {
        parts.push(`Maghrib: ${beforeMaghrib || 'Tiada'} → ${afterMaghrib || 'Tiada'}`);
    }

    // Khas is independent of which ustaz/pending value is set above, so it
    // gets its own diff line rather than folding into the Subuh/Maghrib text.
    if (!!before?.subuh_khas !== !!afterSubuhKhas) {
        parts.push(`Kuliah Khas (Subuh): ${before?.subuh_khas ? 'Ya' : 'Tidak'} → ${afterSubuhKhas ? 'Ya' : 'Tidak'}`);
    }
    if (!!before?.maghrib_khas !== !!afterMaghribKhas) {
        parts.push(`Kuliah Khas (Maghrib): ${before?.maghrib_khas ? 'Ya' : 'Tidak'} → ${afterMaghribKhas ? 'Ya' : 'Tidak'}`);
    }

    // Ditangguhkan is independent of ustaz/pending/khas above, own diff lines.
    if (!!before?.subuh_ditangguhkan !== !!afterSubuhDitangguhkan) {
        parts.push(`Ditangguhkan (Subuh): ${before?.subuh_ditangguhkan ? 'Ya' : 'Tidak'} → ${afterSubuhDitangguhkan ? 'Ya' : 'Tidak'}`);
    }
    if (!!before?.maghrib_ditangguhkan !== !!afterMaghribDitangguhkan) {
        parts.push(`Ditangguhkan (Maghrib): ${before?.maghrib_ditangguhkan ? 'Ya' : 'Tidak'} → ${afterMaghribDitangguhkan ? 'Ya' : 'Tidak'}`);
    }

    const beforeCuti = before?.cuti_umum || null;
    if ((beforeCuti || null) !== (afterCuti || null)) {
        parts.push(`Cuti Umum: ${beforeCuti ? `"${beforeCuti}"` : 'Tiada'} → ${afterCuti ? `"${afterCuti}"` : 'Tiada'}`);
    }

    return parts.length ? parts.join('; ') : null;
}

async function saveDay() {
    if (!editingDate) return;

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';

    const subuhPending   = document.getElementById('subuh-pending-check').checked;
    const maghribPending = document.getElementById('maghrib-pending-check').checked;
    const subuhKhas      = document.getElementById('subuh-khas-check').checked;
    const maghribKhas    = document.getElementById('maghrib-khas-check').checked;
    const subuhDitangguhkan   = document.getElementById('subuh-ditangguhkan-check').checked;
    const maghribDitangguhkan = document.getElementById('maghrib-ditangguhkan-check').checked;
    const subuhId   = subuhPending   ? null : (document.getElementById('subuh-select').value   || null);
    const maghribId = maghribPending ? null : (document.getElementById('maghrib-select').value || null);
    const hasCuti   = document.getElementById('cuti-check').checked;
    const cutiText  = hasCuti ? (document.getElementById('cuti-text').value.trim() || null) : null;
    const before    = scheduleMap[editingDate];

    try {
        await kuliahApi('day', {
            method: 'POST',
            body: {
                row: {
                    date: editingDate,
                    subuh_ustaz_id: subuhId,
                    maghrib_ustaz_id: maghribId,
                    subuh_pending: subuhPending,
                    maghrib_pending: maghribPending,
                    subuh_khas: subuhKhas,
                    maghrib_khas: maghribKhas,
                    subuh_ditangguhkan: subuhDitangguhkan,
                    maghrib_ditangguhkan: maghribDitangguhkan,
                    cuti_umum: cutiText,
                },
            },
        });
    } catch (e) {
        showToast('Gagal menyimpan: ' + e.message, 'error');
        saveBtn.disabled  = false;
        saveBtn.textContent = 'Simpan';
        return;
    }

    saveBtn.disabled  = false;
    saveBtn.textContent = 'Simpan';

    showToast('Berjaya disimpan', 'success');
    const diff = buildDayDiffText(before, subuhId, maghribId, cutiText, subuhPending, maghribPending, subuhKhas, maghribKhas, subuhDitangguhkan, maghribDitangguhkan);
    if (diff) await neonLog('schedule_day_edit', formatDateMY(editingDate), diff);
    closeModal();
    await loadMonth();
}

// ─── Publish ──────────────────────────────────────────────────────────────────
// Cookie session (Google OAuth via /api/auth) is sent automatically —
// same-origin fetch includes cookies by default, no header needed.
async function publishMonth() {
    const btn      = document.getElementById('publish-btn');
    btn.disabled   = true;
    btn.innerHTML  = '<span class="spinner"></span> Menerbitkan...';

    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    try {
        const res  = await fetch(`/api/publish?month=${monthStr}`, { method: 'POST' });
        // Local dev servers (python http.server / Live Server) have no
        // /api/* serverless route — they answer with an HTML error page, not
        // JSON. Parse defensively so that shows a clear message instead of
        // the raw "Unexpected end of JSON input" from res.json().
        const text = await res.text();
        let data = null;
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }

        if (!data) {
            showToast('Tidak dapat menerbitkan dari local — sila uji Terbitkan di Vercel (preview/production) sahaja.', 'error', 8000);
        } else if (!res.ok) {
            const detail = data.details ? ` (${data.status}: ${data.details})` : '';
            showToast('Gagal menerbitkan: ' + (data.error || res.statusText) + detail, 'error', 8000);
        } else {
            const rows = data.published?.rows ?? 0;
            showToast(`Berjaya diterbitkan! ${rows} hari dalam jadual.`, 'success', 6000);
            await updateScheduleActions();
        }
    } catch (err) {
        showToast('Ralat sambungan: ' + err.message, 'error');
    }

    btn.disabled  = false;
    btn.textContent = `Terbitkan ${monthLabel(currentYear, currentMonth)}`;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
init();
