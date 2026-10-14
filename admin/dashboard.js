// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;

    const hasKuliah = currentAdmin.role === 'super_admin' || !!currentAdmin.permissions?.kuliah;
    const hasInfaq  = currentAdmin.role === 'super_admin' || !!currentAdmin.permissions?.infaq;
    const hasKalendar = currentAdmin.role === 'super_admin' || !!currentAdmin.permissions?.kalendar;

    if (!hasKuliah && !hasInfaq && !hasKalendar) {
        document.getElementById('no-access-message').style.display = '';
        return;
    }

    const tasks = [];
    if (hasKuliah) {
        document.getElementById('kuliah-overview').style.display = '';
        tasks.push(loadKuliahOverview());
    }
    if (hasInfaq) {
        document.getElementById('infaq-overview').style.display = '';
        tasks.push(loadInfaqOverview());
    }
    if (hasKalendar) {
        document.getElementById('kalendar-overview').style.display = '';
        tasks.push(loadKalendarOverview());
    }
    await Promise.all(tasks);
})();

// ─── Kuliah glimpse ─────────────────────────────────────────────────────────
// Reuses the exact query shapes jadual.js already established (month-bounded
// schedule fetch + ustaz lookup, countFilledDays' truthy-field check, the
// activity_log 'publish' lookup keyed by month label) — new instances here
// since this page has no shared module system with kuliah/jadual.js, not a
// reimplementation of different logic.
async function loadKuliahOverview() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = todayString();
    const padMonth = String(month).padStart(2, '0');

    let sched;
    try {
        sched = await kuliahApi('schedule', { params: { month: `${year}-${padMonth}` } });
    } catch (e) {
        document.getElementById('kuliah-today-subuh').textContent = 'Gagal memuatkan data kuliah.';
        document.getElementById('kuliah-today-maghrib').textContent = '';
        document.getElementById('kuliah-upcoming-list').textContent = 'Gagal memuatkan data kuliah.';
        return;
    }

    const ustaz = sched.ustaz, rows = sched.rows;

    const ustazMap = Object.fromEntries((ustaz || []).map(u => [u.id, u]));
    const scheduleRows = rows || [];

    renderTodaySession(scheduleRows.find(r => r.date === today), ustazMap);

    // Upcoming: rest of the current month only, after today, with something
    // recorded — keeps this a single-query glimpse rather than also reaching
    // into next month's table.
    const upcoming = scheduleRows
        .filter(r => r.date > today && (r.subuh_ustaz_id || r.maghrib_ustaz_id || r.subuh_pending || r.maghrib_pending || r.cuti_umum))
        .slice(0, 5);
    renderUpcoming(upcoming, ustazMap);

    const filledCount = scheduleRows.filter(r =>
        r.subuh_ustaz_id || r.maghrib_ustaz_id || r.subuh_pending || r.maghrib_pending || r.cuti_umum
    ).length;
    document.getElementById('kuliah-month-completion').textContent =
        `${filledCount} / ${lastDayOfMonth(year, month)} hari lengkap`;

    await loadKuliahLastPublished(monthLabel(year, month));
}

function sessionText(ustazId, pending, ustazMap) {
    if (pending) return 'Belum Ditetapkan';
    if (ustazId) return ustazMap[ustazId]?.short_name || '—';
    return 'Tiada Kuliah';
}

function renderTodaySession(row, ustazMap) {
    document.getElementById('kuliah-today-label').textContent = formatDateMY(todayString());
    if (row?.cuti_umum) {
        document.getElementById('kuliah-today-subuh').textContent   = `Cuti Umum — ${row.cuti_umum}`;
        document.getElementById('kuliah-today-maghrib').textContent = '';
        return;
    }
    document.getElementById('kuliah-today-subuh').textContent   = `Subuh: ${sessionText(row?.subuh_ustaz_id, row?.subuh_pending, ustazMap)}`;
    document.getElementById('kuliah-today-maghrib').textContent = `Maghrib: ${sessionText(row?.maghrib_ustaz_id, row?.maghrib_pending, ustazMap)}`;
}

function renderUpcoming(rows, ustazMap) {
    const el = document.getElementById('kuliah-upcoming-list');
    if (!rows.length) {
        el.innerHTML = '<p style="margin:0;color:var(--text-muted);font-size:0.8125rem">Tiada kuliah akan datang direkodkan bulan ini.</p>';
        return;
    }
    el.innerHTML = rows.map(row => {
        if (row.cuti_umum) {
            return `<p style="margin:0 0 0.375rem;font-size:0.8125rem"><strong>${formatDateMY(row.date)}</strong> — Cuti Umum: ${escapeHtml(row.cuti_umum)}</p>`;
        }
        const subuh   = sessionText(row.subuh_ustaz_id, row.subuh_pending, ustazMap);
        const maghrib = sessionText(row.maghrib_ustaz_id, row.maghrib_pending, ustazMap);
        return `<p style="margin:0 0 0.375rem;font-size:0.8125rem"><strong>${formatDateMY(row.date)}</strong> — Subuh: ${escapeHtml(subuh)}, Maghrib: ${escapeHtml(maghrib)}</p>`;
    }).join('');
}

async function loadKuliahLastPublished(label) {
    const el = document.getElementById('kuliah-last-published');
    let out;
    try {
        out = await kuliahApi('last-published', { params: { label } });
    } catch (e) {
        el.textContent = 'Belum diterbitkan bulan ini.';
        return;
    }
    const row = out && out.row;
    if (!row) {
        el.textContent = 'Belum diterbitkan bulan ini.';
        return;
    }
    const who = row.actor_name || row.actor_email;
    el.textContent = `${formatRelativeMY(row.created_at)} oleh ${who}`;
}

// ─── Infaq glimpse ──────────────────────────────────────────────────────────
// Deliberately narrower than ringkasan.js's loadStats() (bulan ini only, no
// bulan lepas/tahun) — this is a glance, ringkasan.html stays the full view.
async function loadInfaqOverview() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;

    const [kutipanRows, belanjaRows, activeOut] = await Promise.all([
        infaqApi('list-kutipan').then(o => o.rows || []).catch(e => {
            console.error('Gagal memuatkan kutipan:', e.message);
            return [];
        }),
        infaqApi('list-perbelanjaan').then(o => o.rows || []).catch(e => {
            console.error('Gagal memuatkan perbelanjaan:', e.message);
            return [];
        }),
        infaqApi('active-project').catch(e => {
            console.error('Gagal memuatkan projek aktif:', e.message);
            return { project: null };
        }),
    ]);

    const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.jumlah), 0);
    document.getElementById('infaq-kutipan-ini').textContent = formatRM(sum(kutipanRows.filter(r => r.tahun === year && r.bulan === month)));
    document.getElementById('infaq-belanja-ini').textContent = formatRM(sum(belanjaRows.filter(r => r.tahun === year && r.bulan === month)));

    const project = activeOut.project;
    if (!project) {
        document.getElementById('infaq-project-card').style.display = 'none';
        document.getElementById('infaq-no-project-card').style.display = '';
        return;
    }

    const terkumpul  = Number(activeOut.total || 0) + Number(project.online_total || 0);
    const peratusan  = project.target_amount > 0 ? Math.round((terkumpul / project.target_amount) * 100) : 0;

    document.getElementById('infaq-project-card').style.display = '';
    document.getElementById('infaq-no-project-card').style.display = 'none';
    document.getElementById('infaq-project-name').textContent = project.name;
    document.getElementById('infaq-project-progress-fill').style.width = `${Math.min(100, peratusan)}%`;
    document.getElementById('infaq-project-progress-text').textContent =
        `${formatRM(terkumpul)} daripada ${formatRM(project.target_amount)} (${peratusan}%)`;
}

// ─── Kalendar glimpse ─────────────────────────────────────────────────────────
// Next upcoming event from the public events.json + staleness warning when the
// last event is <30 days out (annual rollover due). Read-only glance —
// senarai.html stays the full editor.
async function loadKalendarOverview() {
    const labelEl = document.getElementById('kalendar-next-label');
    const subEl = document.getElementById('kalendar-next-sub');
    const staleEl = document.getElementById('kalendar-stale-note');
    try {
        const res = await fetch(`/calendar/hijri/data/events.json?v=${Date.now()}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        const today = todayString();
        const upcoming = (data.events || [])
            .filter(e => e.eventDate && e.eventDate >= today)
            .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
        if (!upcoming.length) {
            labelEl.textContent = 'Tiada acara akan datang.';
            subEl.textContent = 'Semua tarikh telah lepas — kemas kini tahunan diperlukan.';
        } else {
            const next = upcoming[0];
            const diffDays = Math.ceil((new Date(next.eventDate + 'T00:00:00') - Date.now()) / 86400000);
            labelEl.textContent = `${next.eventName} — ${formatDateMY(next.eventDate)}`;
            subEl.textContent = `${next.hijriDate || ''} · ${diffDays <= 0 ? 'Hari ini' : diffDays + ' hari lagi'}`;
        }
        const all = (data.events || []).filter(e => e.eventDate)
            .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
        const lastDate = all.length ? all[all.length - 1].eventDate : null;
        const daysLeft = lastDate
            ? Math.ceil((new Date(lastDate + 'T00:00:00') - Date.now()) / 86400000) : null;
        if (daysLeft === null) {
            staleEl.textContent = 'Tiada data acara.';
        } else if (daysLeft < 0) {
            staleEl.innerHTML = `<strong style="color:var(--danger)">Data tamat — acara terakhir telah lepas (${escapeHtml(lastDate)}).</strong> Sila kemas kini tahunan.`;
        } else if (daysLeft < 30) {
            staleEl.innerHTML = `<strong style="color:var(--danger)">Kemas kini tahunan diperlukan — tinggal ${daysLeft} hari sehingga acara terakhir (${escapeHtml(lastDate)}).</strong>`;
        } else {
            staleEl.textContent = `Data sah sehingga ${formatDateMY(lastDate)} (${daysLeft} hari lagi). Kemas kini: ${data.lastUpdated || '—'}`;
        }
    } catch (e) {
        labelEl.textContent = 'Gagal memuatkan data kalendar.';
        subEl.textContent = '';
        staleEl.textContent = `Ralat: ${e.message}`;
    }
}
