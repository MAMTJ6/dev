// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
    const session = await requireKuliahAuth();
    if (!session) return;
    if (!(await requireInfaqAccess())) return;
    await Promise.all([
        loadStats(),
        loadActiveProject(),
    ]);
})();

// ─── Stat cards ───────────────────────────────────────────────────────────────
// Deliberately simple client-side sums over fetched rows — NOT a reimplementation
// of api/publish-infaq.js's week-bucket/graf logic (same separation of concerns
// jadual.js already has from api/publish.js: this page previews, the
// serverless function computes the real published output). Both source
// tables are already pre-aggregated by (tahun,bulan[,minggu]), so this is
// just grouping/summing integers — no date-string range math needed.
async function loadStats() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    let lastMonthYear = year, lastMonth = month - 1;
    if (lastMonth < 1) { lastMonth = 12; lastMonthYear = year - 1; }

    const [kutipanRows, belanjaRows] = await Promise.all([
        infaqApi('list-kutipan').then(o => o.rows || []).catch(e => {
            console.error('Gagal memuatkan kutipan:', e.message);
            return [];
        }),
        infaqApi('list-perbelanjaan').then(o => o.rows || []).catch(e => {
            console.error('Gagal memuatkan perbelanjaan:', e.message);
            return [];
        }),
    ]);
    const inYears = r => r.tahun === year || r.tahun === lastMonthYear;
    const kutipanSel = kutipanRows.filter(inYears);
    const belanjaSel = belanjaRows.filter(inYears);
    const sumMonth = (rows, y, m) => rows.filter(r => r.tahun === y && r.bulan === m).reduce((s, r) => s + Number(r.jumlah), 0);
    const sumYear  = (rows, y) => rows.filter(r => r.tahun === y).reduce((s, r) => s + Number(r.jumlah), 0);

    document.getElementById('stat-kutipan-ini').textContent   = formatRM(sumMonth(kutipanSel, year, month));
    document.getElementById('stat-kutipan-lepas').textContent = formatRM(sumMonth(kutipanSel, lastMonthYear, lastMonth));
    document.getElementById('stat-kutipan-tahun').textContent = formatRM(sumYear(kutipanSel, year));

    document.getElementById('stat-belanja-ini').textContent   = formatRM(sumMonth(belanjaSel, year, month));
    document.getElementById('stat-belanja-lepas').textContent = formatRM(sumMonth(belanjaSel, lastMonthYear, lastMonth));
    document.getElementById('stat-belanja-tahun').textContent = formatRM(sumYear(belanjaSel, year));
}

// ─── Active project progress ────────────────────────────────────────────────
async function loadActiveProject() {
    let out;
    try {
        out = await infaqApi('active-project');
    } catch (e) {
        console.error('Gagal memuatkan projek aktif:', e.message);
        document.getElementById('project-card').style.display = 'none';
        document.getElementById('no-project-card').style.display = '';
        return;
    }
    const project = out.project;

    if (!project) {
        document.getElementById('project-card').style.display = 'none';
        document.getElementById('no-project-card').style.display = '';
        return;
    }

    const terkumpul = Number(out.total || 0) + Number(project.online_total || 0);
    const peratusan = project.target_amount > 0 ? Math.round((terkumpul / project.target_amount) * 100) : 0;

    document.getElementById('project-card').style.display = '';
    document.getElementById('no-project-card').style.display = 'none';
    document.getElementById('project-name').textContent = project.name;
    document.getElementById('project-progress-fill').style.width = `${Math.min(100, peratusan)}%`;
    document.getElementById('project-progress-text').textContent =
        `${formatRM(terkumpul)} daripada ${formatRM(project.target_amount)} (${peratusan}%)`;
}
