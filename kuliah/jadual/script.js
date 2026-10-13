/* =========================================================
   Masjid Al-Mukhlisin — Jadual Kuliah Maghrib & Subuh
   Vanilla JS (ES6+). Renders desktop table for browser + Xibo.
   ========================================================= */


const DAY_NAMES = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'];
const MONTH_NAMES = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
    'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

let cachedSenaraiHari = null;
let cachedMonthsData = null; // full jsonData.months, for cross-month "Hari Esok" lookups (last day of month)
let swapSessionOrder = false; // session-only view mode; resets to false on every hard reload
let hijriRequestId = 0; // guards against a slow response overwriting a newer day selection
const hijriMonthCache = {}; // "YYYY-M" → prayers[] from api.waktusolat.app (one fetch covers the whole month)

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */
function pad2(n) {
    return String(n).padStart(2, '0');
}

// The e-solat API can hang for minutes — never wait on it without a deadline.
function fetchWithTimeout(url, ms = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------
   Data fetch
   --------------------------------------------------------- */
async function fetchScheduleData() {
    const response = await fetch(`/kuliah/data/jadual_lengkap_v2.json?v=${new Date().getTime()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/* ---------------------------------------------------------
   Lecture block builders (return HTML strings)
   --------------------------------------------------------- */
function createLectureBlock(type, sessionData) {
    const khasLabel = type === 'subuh' ? 'Kuliah Subuh Khas' : 'Kuliah Maghrib Khas';
    const posterAttr = sessionData.poster_url ? ` data-poster-url="${escapeHtml(sessionData.poster_url)}"` : '';
    // Carries the flag into the lightbox (see initPosterLightbox) so the
    // enlarged desktop poster gets the same dim + overlay treatment.
    const ditangguhkanAttr = (sessionData.poster_url && sessionData.ditangguhkan) ? ' data-ditangguhkan="true"' : '';
    const posterClass = sessionData.poster_url ? ' has-poster' : '';

    // Special case — slot reserved but ustaz/topic not decided yet
    if (sessionData.pending) {
        const label = sessionData.khas ? khasLabel : (type === 'subuh' ? 'Subuh' : 'Maghrib');
        const khasClass = sessionData.khas ? ' is-khas' : '';
        return `<div class="lecture-block is-pending${khasClass}${posterClass}"${posterAttr}${ditangguhkanAttr}>
                    <div class="lecture-time ${type}">${label}</div>
                    <div class="pending-label">Akan Diumumkan</div>
                </div>`;
    }

    // Special case — Bacaan Yasiin & Tahlil
    if (sessionData.nama_penceramah && sessionData.nama_penceramah.indexOf('Yasiin') !== -1) {
        return `<div class="lecture-block yasin-block${posterClass}"${posterAttr}>
                    <div class="arabic-text" lang="ar" dir="rtl">باچاءن يسٓ دان تهليل</div>
                    <div class="yasin-title">BACAAN YASIIN &amp; TAHLIL</div>
                </div>`;
    }

    const label = sessionData.khas ? khasLabel : (type === 'subuh' ? 'Subuh' : 'Maghrib');
    const khasClass = sessionData.khas ? ' is-khas' : '';
    const ditangguhkanClass = sessionData.ditangguhkan ? ' is-ditangguhkan' : '';
    return `<div class="lecture-block${khasClass}${ditangguhkanClass}${posterClass}"${posterAttr}${ditangguhkanAttr}>
                <div class="lecture-time ${type}">${label}</div>
                <div class="ustaz-name">${escapeHtml(sessionData.nama_penceramah)}</div>
                <div class="lecture-title">${escapeHtml(sessionData.tajuk_kuliah)}</div>
                ${sessionData.ditangguhkan ? '<div class="ditangguhkan-label">DITANGGUHKAN</div>' : ''}
            </div>`;
}

function createEmptyLectureBlock(type) {
    const label = type === 'subuh' ? 'Subuh' : 'Maghrib';
    return `<div class="lecture-block is-weekend-empty">
                <div class="lecture-time ${type}">${label}</div>
                <div class="empty-slot-text">Slot Kosong</div>
            </div>`;
}

/* ---------------------------------------------------------
   Single day cell builder (returns HTML string)
   --------------------------------------------------------- */
function buildDayCell(dayNumber, year, month, dataByDate, todayString) {
    // No day → padding cell
    if (!dayNumber) {
        return '<td class="day-cell empty-cell"></td>';
    }

    const dateObj = new Date(year, month, dayNumber);   // day-of-week detection
    const dayOfWeek = dateObj.getDay();                 // 0 = Sun, 6 = Sat
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const dateString = `${year}-${pad2(month + 1)}-${pad2(dayNumber)}`;
    const entry = dataByDate[dateString];

    let cellClass = 'day-cell';
    if (dateString === todayString) {
        cellClass += ' is-today';
    }

    // STATE 5 — no JSON entry for this date
    if (!entry) {
        return `<td class="${cellClass}">
                    <div class="date-number">${dayNumber}</div>
                    <div class="lecture-content"></div>
                </td>`;
    }

    // Layer 1 — date number
    let inner = `<div class="date-number">${dayNumber}</div>`;

    // Layer 2 — holiday header (STATE 3)
    if (entry.cuti_umum) {
        inner += `<div class="date-header">
                      <span class="holiday-label">🌙 ${escapeHtml(entry.cuti_umum)}</span>
                  </div>`;
    }

    // Layer 3 — lecture content
    const subuh = entry.subuh;
    const maghrib = entry.maghrib;

    // STATE 4 — full-day empty
    if (!subuh && !maghrib) {
        return `<td class="${cellClass}">
                    ${inner}
                    <div class="lecture-content is-empty-slot">
                        <div class="empty-slot-text">Slot Kosong</div>
                    </div>
                </td>`;
    }

    // STATE 1 — normal day (one or both sessions)
    let blocks = '';

    // Subuh
    if (subuh) {
        blocks += createLectureBlock('subuh', subuh);
    } else if (isWeekend) {
        blocks += createEmptyLectureBlock('subuh');
    }

    // Maghrib
    if (maghrib) {
        blocks += createLectureBlock('maghrib', maghrib);
    } else if (isWeekend) {
        blocks += createEmptyLectureBlock('maghrib');
    }

    // Cell-level highlight classes — computed from the rendered blocks HTML
    // rather than relying on CSS :has(), which older WebView2/Chromium
    // builds (e.g. an un-updated Xibo signage player) silently don't support.
    // See kuliah/CLAUDE.md for why this replaced the :has()-based CSS.
    const blockCount = (blocks.match(/class="lecture-block\b/g) || []).length;
    const isShared   = blockCount > 1;
    const hasKhas    = /\bis-khas\b/.test(blocks);
    const hasDitangguhkan = /\bis-ditangguhkan\b/.test(blocks);
    const hasYasin   = /\byasin-block\b/.test(blocks);

    let contentClass = 'lecture-content';
    if (hasKhas) contentClass += ' has-khas';
    if (hasDitangguhkan) contentClass += ' has-ditangguhkan';
    if (hasYasin) contentClass += isShared ? ' has-yasin-shared' : ' has-yasin-solo';

    inner += `<div class="${contentClass}">${blocks}</div>`;

    return `<td class="${cellClass}">${inner}</td>`;
}

/* ---------------------------------------------------------
   Desktop calendar renderer
   --------------------------------------------------------- */
function renderCalendarDesktop(senaraiHari, targetDate) {
    const tbody = document.getElementById('calendar-body');
    if (!tbody) return;

    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=Sun … 6=Sat
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Index data by ISO date string
    const dataByDate = {};
    senaraiHari.forEach(d => { dataByDate[d.date] = d; });

    // Today string (for highlight)
    const today = new Date();
    const todayString = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

    // Build a 35-slot grid; place day 1 at firstDayOfMonth.
    // Overflow beyond 35 wraps back into empty slots of the grid.
    const slots = new Array(35).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
        const idx = (firstDayOfMonth + day - 1) % 35;
        slots[idx] = day;
    }

    let html = '';
    for (let row = 0; row < 5; row++) {
        html += '<tr>';
        for (let col = 0; col < 7; col++) {
            const idx = row * 7 + col;
            html += buildDayCell(slots[idx], year, month, dataByDate, todayString);
        }
        html += '</tr>';
    }

    tbody.innerHTML = html;
}

/* ---------------------------------------------------------
   Mobile lecture block builder (returns HTML string)
   --------------------------------------------------------- */
function createMobileLectureBlock(time, lecture) {
    const badgeClass = time.toLowerCase();
    const khasClass = lecture.khas ? ' is-khas' : '';
    const ditangguhkanClass = lecture.ditangguhkan ? ' is-ditangguhkan' : '';
    const badgeLabel = lecture.khas
        ? (time === 'Subuh' ? 'Kuliah Subuh Khas' : 'Kuliah Maghrib Khas')
        : time;
    if (lecture.pending) {
        return `<div class="lecture-block-v2 is-pending${khasClass}">
                    <span class="session-badge ${badgeClass}${khasClass}">${badgeLabel}</span>
                    <div class="pending-label">Akan Diumumkan</div>
                </div>`;
    }
    if (lecture.nama_penceramah && lecture.nama_penceramah.indexOf('Yasiin') !== -1) {
        return `<div class="lecture-block-v2">
                    <span class="session-badge ${badgeClass}">${time}</span>
                    <div class="lecture-ustaz" lang="ar" dir="rtl" style="font-size:1.1rem;text-align:center;">باچاءن يسٓ دان تهليل</div>
                    <div class="lecture-tajuk">BACAAN YASIIN &amp; TAHLIL</div>
                </div>`;
    }
    return `<div class="lecture-block-v2${khasClass}${ditangguhkanClass}">
                <span class="session-badge ${badgeClass}${khasClass}">${badgeLabel}</span>
                <div class="lecture-ustaz">${escapeHtml(lecture.nama_penceramah)}</div>
                <div class="lecture-tajuk">${escapeHtml(lecture.tajuk_kuliah)}</div>
                ${lecture.ditangguhkan ? '<div class="ditangguhkan-label">DITANGGUHKAN</div>' : ''}
            </div>`;
}

/* ---------------------------------------------------------
   Mobile view — monthly card list
   --------------------------------------------------------- */
async function initializeMobileView(senaraiHari, targetDate, notYetPublished = false) {
    const mobileListContainer = document.getElementById('mobile-card-list');
    if (!mobileListContainer) return;

    if (notYetPublished) {
        mobileListContainer.innerHTML = '<div class="no-kuliah-today">Jadual belum diterbitkan buat masa ini.</div>';
        const todayCard = document.getElementById('today-kuliah-card');
        if (todayCard) todayCard.style.display = 'none';
        return;
    }

    const today = new Date();
    const isCurrentMonth = targetDate.getMonth() === today.getMonth() &&
        targetDate.getFullYear() === today.getFullYear();

    if (isCurrentMonth) {
        await renderTodayCard(senaraiHari);
    } else {
        const todayCard = document.getElementById('today-kuliah-card');
        if (todayCard) todayCard.style.display = 'none';
    }

    const daysInMalay = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
    const monthNames = MONTH_NAMES;
    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    const days = senaraiHari.filter(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.getMonth() === targetMonth && date.getFullYear() === targetYear;
    });

    const emptyCards = [];

    days.forEach(dayData => {
        const currentDate = new Date(dayData.date + 'T00:00:00');
        if (isCurrentMonth && currentDate.toDateString() === today.toDateString()) return;

        const isEmpty = !dayData.subuh && !dayData.maghrib;
        const card = document.createElement('div');
        card.className = 'mobile-card-v2' + (dayData.cuti_umum ? ' is-holiday' : '');

        const dayName = daysInMalay[currentDate.getDay()];
        const dateNum = `${currentDate.getDate()} ${monthNames[currentDate.getMonth()]}`;
        const holidayPill = dayData.cuti_umum
            ? `<span class="mobile-holiday-label">${escapeHtml(dayData.cuti_umum)}</span>` : '';

        let bodyHtml = '';
        if (isEmpty) {
            bodyHtml = `<div class="empty-slot-v2">Tiada kuliah</div>`;
        } else {
            if (dayData.subuh) bodyHtml += createMobileLectureBlock('Subuh', dayData.subuh);
            if (dayData.maghrib) bodyHtml += createMobileLectureBlock('Maghrib', dayData.maghrib);
        }

        card.innerHTML = `
            <div class="card-date-header-v2">
                <span class="card-day-label">${dayName}${holidayPill}</span>
                <span class="card-date-number">${dateNum}</span>
            </div>
            <div class="card-body-v2">${bodyHtml}</div>`;

        if (isEmpty) {
            emptyCards.push(card);
        } else {
            mobileListContainer.appendChild(card);
        }
    });

    if (emptyCards.length > 0) {
        const toggle = document.createElement('button');
        toggle.className = 'show-empty-toggle';
        toggle.textContent = `Tunjuk ${emptyCards.length} hari tiada kuliah ▾`;
        toggle.addEventListener('click', () => {
            emptyCards.forEach(c => mobileListContainer.appendChild(c));
            toggle.remove();
        });
        mobileListContainer.appendChild(toggle);
    }
}

/* ---------------------------------------------------------
   Mobile view — today / tomorrow / any-day-this-month card
   --------------------------------------------------------- */
// Lists every day of `today`'s month, with "Hari Ini"/"Hari Esok" pinned first
// (using their real dates, even if "tomorrow" spills into next month).
function buildDaySelectOptions(today, selectedDateString) {
    const year  = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const todayString = `${year}-${pad2(month + 1)}-${pad2(today.getDate())}`;
    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowString = `${tomorrowDate.getFullYear()}-${pad2(tomorrowDate.getMonth() + 1)}-${pad2(tomorrowDate.getDate())}`;

    const opt = (value, label) => `<option value="${value}" ${value === selectedDateString ? 'selected' : ''}>${label}</option>`;

    let opts = opt(todayString, 'Hari Ini') + opt(tomorrowString, 'Hari Esok');

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        if (dateStr === todayString || dateStr === tomorrowString) continue; // already pinned above
        opts += opt(dateStr, `${d} ${MONTH_NAMES[month]}`);
    }
    return opts;
}

// Every day (including today/tomorrow) renders its own poster_url directly.
// A ditangguhkan poster renders dimmed under a scaled-down tilted stamp
// (same visual language as kuliah/paparan/, sized for a phone screen).
function buildPosterHtml(type, session) {
    if (!session.poster_url) return '';
    const label = type === 'subuh' ? 'Subuh' : 'Maghrib';
    if (!session.ditangguhkan) {
        return `<div class="poster-section"><div class="poster-wrapper"><img class="poster-img" src="${escapeHtml(session.poster_url)}" alt="Poster Kuliah ${label}" loading="lazy"></div></div>`;
    }
    return `<div class="poster-section"><div class="poster-wrapper has-ditangguhkan"><img class="poster-img" src="${escapeHtml(session.poster_url)}" alt="Poster Kuliah ${label} (Ditangguhkan)" loading="lazy" data-ditangguhkan="true"><div class="poster-ditangguhkan-overlay" aria-hidden="true"><span>KULIAH<br>DITANGGUHKAN</span></div></div></div>`;
}

// Tap-to-enlarge lightbox for poster images — the mobile today-card's
// .poster-img, and the desktop calendar's .lecture-block cells (which carry
// a data-poster-url attribute instead of an <img>, see createLectureBlock()).
// Uses a delegated click listener (attached once at boot) rather than
// per-element listeners, since both renderTodayCard() and
// renderCalendarDesktop() replace their container's inner HTML on every
// day-select/month change — delegation survives re-renders without needing
// re-attachment.
function initPosterLightbox() {
    const overlay = document.getElementById('poster-lightbox');
    const lightboxImg = document.getElementById('poster-lightbox-img');
    const lightboxNotice = document.getElementById('poster-lightbox-ditangguhkan');
    if (!overlay || !lightboxImg) return;

    function open(src, alt, ditangguhkan) {
        lightboxImg.src = src;
        lightboxImg.alt = alt || '';
        // Same dim + tilted-stamp treatment as paparan, at full scale — the
        // enlarged poster fills the screen, same viewing situation as signage.
        lightboxImg.classList.toggle('is-dimmed', !!ditangguhkan);
        if (lightboxNotice) lightboxNotice.hidden = !ditangguhkan;
        overlay.hidden = false;
        document.body.classList.add('no-scroll');
    }
    function close() {
        overlay.hidden = true;
        lightboxImg.src = '';
        lightboxImg.classList.remove('is-dimmed');
        if (lightboxNotice) lightboxNotice.hidden = true;
        document.body.classList.remove('no-scroll');
    }

    document.addEventListener('click', (e) => {
        const posterImg = e.target.closest('.poster-img');
        if (posterImg) {
            open(posterImg.src, posterImg.alt, posterImg.dataset.ditangguhkan === 'true');
            return;
        }
        const posterCell = e.target.closest('.lecture-block[data-poster-url]');
        if (posterCell) {
            open(posterCell.dataset.posterUrl, posterCell.querySelector('.ustaz-name')?.textContent || '', posterCell.dataset.ditangguhkan === 'true');
        }
    });
    overlay.addEventListener('click', close); // backdrop or the enlarged image itself
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) close();
    });
}

async function renderTodayCard(senaraiHari, selectedDate = null) {
    const todayContainer = document.getElementById('today-kuliah-card');
    if (!todayContainer) return;

    cachedSenaraiHari = senaraiHari;
    todayContainer.classList.add('is-today-card');

    const today = new Date();
    const todayString = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowString = `${tomorrow.getFullYear()}-${pad2(tomorrow.getMonth() + 1)}-${pad2(tomorrow.getDate())}`;

    const targetDateString = selectedDate || todayString;
    const targetDate = new Date(targetDateString + 'T00:00:00');
    // "Hari Esok" on the last day of the month points at a date outside the
    // currently-loaded month's senaraiHari — fall back to the full months
    // object so tomorrow's card still shows real data if it's published.
    let targetData = senaraiHari.find(d => d.date === targetDateString);
    if (!targetData && cachedMonthsData) {
        const targetMonthKey = targetDateString.slice(0, 7);
        targetData = cachedMonthsData[targetMonthKey]?.senaraiHari?.find(d => d.date === targetDateString);
    }

    const isToday    = targetDateString === todayString;
    const isTomorrow = targetDateString === tomorrowString;

    let cardBody = '';
    let bothSessions = false;
    if (targetData && (targetData.subuh || targetData.maghrib)) {
        bothSessions = !!(targetData.subuh && targetData.maghrib);

        const subuhHtml = targetData.subuh
            ? createMobileLectureBlock('Subuh', targetData.subuh) + buildPosterHtml('subuh', targetData.subuh)
            : '';
        const maghribHtml = targetData.maghrib
            ? createMobileLectureBlock('Maghrib', targetData.maghrib) + buildPosterHtml('maghrib', targetData.maghrib)
            : '';

        cardBody = (swapSessionOrder && bothSessions) ? (maghribHtml + subuhHtml) : (subuhHtml + maghribHtml);
    } else if (isTomorrow && !targetData) {
        cardBody = `<div class="no-kuliah-today">Data jadual untuk esok belum tersedia.</div>`;
    } else {
        const dayLabel = isToday ? 'hari ini' : isTomorrow ? 'esok' : `pada ${targetDate.getDate()} ${MONTH_NAMES[targetDate.getMonth()]}`;
        cardBody = `<div class="no-kuliah-today">Tiada kuliah dijadualkan ${dayLabel}.</div>`;
    }

    const holidayHtml = targetData && targetData.cuti_umum
        ? `<span class="mobile-holiday-label">${escapeHtml(targetData.cuti_umum)}</span>` : '';

    const swapToggleHtml = bothSessions
        ? `<button type="button" class="swap-session-toggle" aria-label="Tukar susunan paparan Subuh dan Maghrib">⇅ Tukar Susunan Subuh/Maghrib</button>`
        : '';

    todayContainer.innerHTML = `
        <div class="today-card-top-bar"></div>
        <div class="today-card-header">
            <div class="day-select-wrapper">
                <select class="day-select">
                    ${buildDaySelectOptions(today, targetDateString)}
                </select>
            </div>
            <div class="today-date-right">
                <div id="today-date-gregorian">Memuatkan tarikh...</div>
                <div id="today-date-hijri" class="hijri-loading"></div>
            </div>
            ${holidayHtml}
        </div>
        <div class="today-card-body">${cardBody}</div>
        ${swapToggleHtml}`;

    todayContainer.querySelector('.day-select').addEventListener('change', async function () {
        await renderTodayCard(cachedSenaraiHari, this.value);
    });

    const swapBtn = todayContainer.querySelector('.swap-session-toggle');
    if (swapBtn) {
        swapBtn.addEventListener('click', async () => {
            swapSessionOrder = !swapSessionOrder;
            await renderTodayCard(cachedSenaraiHari, targetDateString);
        });
    }

    // Fire-and-forget — the Hijri line fills in whenever the API (or the
    // calculator fallback) answers. Never block the month card list on it.
    loadHijriDate(targetDate);
}

/* ---------------------------------------------------------
   Hijri date — JAKIM API with JS calculator fallback
   --------------------------------------------------------- */
function gregorianToHijri(date) {
    const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
    const a = Math.floor((14 - m) / 12);
    const yj = y + 4800 - a, mj = m + 12 * a - 3;
    const jd = d + Math.floor((153 * mj + 2) / 5) + 365 * yj +
        Math.floor(yj / 4) - Math.floor(yj / 100) + Math.floor(yj / 400) - 32045;
    const l = jd - 1948440 + 10632;
    const n = Math.floor((l - 1) / 10631);
    const l2 = l - 10631 * n + 354;
    const j = Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
        Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
    const l3 = l2 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
        Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    const hMonth = Math.floor((24 * l3) / 709);
    return { day: l3 - Math.floor((709 * hMonth) / 24), month: hMonth, year: 30 * n + j - 30 };
}

async function loadHijriDate(targetDate = new Date()) {
    const reqId = ++hijriRequestId;
    const elGreg = document.getElementById('today-date-gregorian');
    if (!elGreg) return;

    const daysInMalay = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
    elGreg.textContent = `${daysInMalay[targetDate.getDay()]}, ${targetDate.getDate()} ${targetDate.toLocaleString('ms-MY', { month: 'long' })} ${targetDate.getFullYear()}`;

    const hijriMonthNames = {
        '01': 'Muharam', '02': 'Safar', '03': "Rabi'ul Awwal", '04': "Rabi'ul Akhir",
        '05': 'Jamadil Awal', '06': 'Jamadil Akhir', '07': 'Rejab', '08': 'Syaaban',
        '09': 'Ramadan', '10': 'Syawal', '11': 'Zulkaedah', '12': 'Zulhijah'
    };

    // Re-queried at write time (not captured up front): the dropdown re-renders
    // the card's innerHTML, so an element grabbed before a slow response would
    // be a detached node. reqId drops stale responses after a newer selection.
    const setHijri = (text) => {
        if (reqId !== hijriRequestId) return;
        const elHijri = document.getElementById('today-date-hijri');
        if (elHijri) {
            elHijri.textContent = text;
            elHijri.classList.remove('hijri-loading');
        }
    };

    const calcFallback = () => {
        const h = gregorianToHijri(targetDate);
        const mp = String(h.month).padStart(2, '0');
        setHijri(`${h.day} ${hijriMonthNames[mp]} ${h.year}H`);
    };

    try {
        // api.waktusolat.app (community JAKIM mirror — fast, CORS-friendly; the
        // official e-solat.gov.my endpoint can hang for minutes). Year/month are
        // explicit for the TARGET date, so a "tomorrow" that spills into next
        // month needs no special case. Hijri dates are national — zone is only
        // nominal here.
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;
        const cacheKey = `${year}-${month}`;

        let prayers = hijriMonthCache[cacheKey];
        if (!prayers) {
            const resp = await fetchWithTimeout(`https://api.waktusolat.app/v2/solat/WLY01?year=${year}&month=${month}`);
            if (!resp.ok) throw new Error('API failed');
            const data = await resp.json();
            prayers = data.prayers;
            if (Array.isArray(prayers)) hijriMonthCache[cacheKey] = prayers;
        }

        const info = Array.isArray(prayers) ? prayers.find(p => p.day === targetDate.getDate()) : null;
        if (!info || !info.hijri) { calcFallback(); return; }
        const hp = info.hijri.split('-');
        setHijri(`${parseInt(hp[2], 10)} ${hijriMonthNames[hp[1]]} ${hp[0]}H`);
    } catch (e) {
        calcFallback();
    }
}

/* ---------------------------------------------------------
   Boot
   --------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
    // 0. Poster tap-to-enlarge lightbox (independent of schedule data)
    initPosterLightbox();

    // 1. URL params
    const urlParams = new URLSearchParams(window.location.search);

    const baseDate = new Date();
    if (urlParams.get('bulan') === 'depan') {
        baseDate.setDate(1);
        baseDate.setMonth(baseDate.getMonth() + 1);
    }
    const monthKey = `${baseDate.getFullYear()}-${pad2(baseDate.getMonth() + 1)}`;

    // 2. Fetch JSON (cache-busted, with embedded fallback)
    const jsonData = await fetchScheduleData();
    cachedMonthsData = jsonData.months ?? {};
    const monthData = jsonData.months?.[monthKey];
    const senaraiHari = monthData?.senaraiHari ?? [];

    // 3. Footer update info — date always visible; full timestamp on
    // desktop hover (title tooltip), inline on touch devices (no hover).
    const updateInfoEl = document.getElementById('update-info');
    if (updateInfoEl) {
        const info = monthData?.infoJadual;
        const masa = info?.kemaskiniMasa || '';
        updateInfoEl.textContent = info?.tarikhKemasKini || '';
        if (masa) {
            const timePart = masa.split(',').slice(1).join(',').trim(); // "2:35 PTG"
            updateInfoEl.title = `Dikemaskini: ${masa}`;
            if (timePart && window.matchMedia('(pointer: coarse)').matches) {
                updateInfoEl.textContent += `, ${timePart}`;
            }
        } else {
            updateInfoEl.removeAttribute('title');
        }
    }

    // 4. Schedule title — always reflects the requested month, not the published data
    const titleEl = document.getElementById('schedule-title');
    if (titleEl) {
        titleEl.textContent = `BULAN ${MONTH_NAMES[baseDate.getMonth()].toUpperCase()} ${baseDate.getFullYear()}`;
    }

    // 5. Render desktop calendar + mobile view
    renderCalendarDesktop(senaraiHari, baseDate);
    await initializeMobileView(senaraiHari, baseDate, !monthData);

    // 5b. Khas legend entry — only shown on a month that actually has one
    const khasLegendEl = document.getElementById('khas-legend');
    if (khasLegendEl) {
        const hasKhas = senaraiHari.some(d => d.subuh?.khas || d.maghrib?.khas);
        khasLegendEl.style.display = hasKhas ? '' : 'none';
    }

    // 5c. Ditangguhkan legend entry — same conditional pattern as khas above
    const ditangguhkanLegendEl = document.getElementById('ditangguhkan-legend');
    if (ditangguhkanLegendEl) {
        const hasDitangguhkan = senaraiHari.some(d => d.subuh?.ditangguhkan || d.maghrib?.ditangguhkan);
        ditangguhkanLegendEl.style.display = hasDitangguhkan ? '' : 'none';
    }

    // 6. Auto-print for PDF context
    if (urlParams.get('file') === 'pdf') {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => { window.print(); }, 250);
            });
        });
    }
});

