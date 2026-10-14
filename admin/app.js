// ─── Session (Neon version — no Supabase client) ──────────────────────────────
// Auth state lives in the HttpOnly `mamtj6_session` cookie (Google OAuth via
// /api/auth). Pages authenticate with requireKuliahAuth() in
// /admin/kuliah/kuliah-api.js (sets `currentAdmin` below so the sidebar and
// gates keep working) and log with neonLog() there. This file keeps only the
// shared UI shell: sidebar, toasts, date/format helpers, icons.

// ─── Current admin (populated by requireKuliahAuth) ───────────────────────────
let currentAdmin = null;

// ─── Auth entry points ────────────────────────────────────────────────────────
// Login button (admin/index.html) → Google OAuth via /api/auth.
function signInWithGoogle() {
    const btn = document.getElementById('google-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Menghubungi Google...'; }
    window.location.href = '/api/auth?action=login';
}

// Every sidebar's "Log Keluar" button → clears the session cookie server-side.
function signOut() {
    window.location.replace('/api/auth?action=logout');
}

// Used for the OAuth return URL and any "no access, go somewhere sane"
// redirect. Every admin with at least one module permission (or
// super_admin) lands on the shared cross-module overview (admin/dashboard.js)
// rather than a per-module page — it links onward to jadual.html/
// ringkasan.html for full detail. Returns null when the admin has no module
// access at all; callers must show a message in that case, never redirect
// (redirecting to another gated/denied page is how you get a bounce loop).
function defaultLandingPageFor(admin) {
    if (!admin) return null;
    if (admin.role === 'super_admin' || admin.permissions?.kuliah || admin.permissions?.infaq || admin.permissions?.news || admin.permissions?.staff || admin.permissions?.khutbah || admin.permissions?.kalendar) return '/admin/dashboard.html';
    return null;
}

// ─── Module access / write gates ───────────────────────────────────────────────
// The read half — generic version of the module-page gate every infaq page
// already called as requireInfaqAccess() (now a 1-line wrapper around this,
// see admin/infaq/infaq-common.js). Call right after requireKuliahAuth():
//   const session = await requireKuliahAuth();
//   if (!session) return;
//   if (!(await requireModuleAccess('kuliah'))) return;
// Toasts + redirects on denial and returns false; returns true if allowed.
// A 'viewer' passes this exactly like 'editor' does — permissions decides
// what a role can SEE, canWriteModule() below decides what it can DO.
async function requireModuleAccess(moduleKey) {
    if (currentAdmin.role === 'super_admin' || currentAdmin.permissions?.[moduleKey]) return true;
    showToast(`Akses ditolak. Anda tiada kebenaran modul ${moduleKey}.`, 'error');
    setTimeout(() => window.location.replace(defaultLandingPageFor(currentAdmin) || '/admin/index.html'), 2000);
    return false;
}

// The write half — UI-level defense-in-depth, mirrors admin/setup.sql's
// admin_can_write() SQL function 1:1 (that's the real enforcement; this is
// just so a viewer/under-permissioned editor never sees a write control
// that's doomed to fail against RLS). 'viewer' always falls through to
// false here since the role check is an exact match on 'super_admin' or
// 'editor', never 'viewer'.
function canWriteModule(moduleKey) {
    if (!currentAdmin) return false;
    return currentAdmin.role === 'super_admin'
        || (currentAdmin.role === 'editor' && !!currentAdmin.permissions?.[moduleKey]);
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
// Single source of truth for every nav link in the admin CMS — hrefs are
// always absolute (/admin/...) since they only ever live here now, which
// structurally rules out the relative-path-under-cleanUrls landmine that
// used to require a comment on every hand-copied nav block. `match` lists
// every pathname that should highlight an item as active, so a sub-page
// like projek-kutipan.html (an infaq detail view, not one of the visible
// labels) can highlight its logical parent ("Projek") without any
// filename-guessing.
const MODULES = [
    {
        key: 'utama', label: 'Utama', permission: null, requiresSuperAdmin: false,
        items: [
            { label: 'Ringkasan Keseluruhan', href: '/admin/dashboard.html', match: ['/admin/dashboard.html'] },
            { label: 'Sejarah Perubahan', href: '/admin/changelog.html', match: ['/admin/changelog.html'] },
        ],
    },
    {
        key: 'kuliah', label: 'Kuliah', permission: 'kuliah', requiresSuperAdmin: false,
        items: [
            { label: 'Jadual',     href: '/admin/kuliah/jadual.html', match: ['/admin/kuliah/jadual.html'] },
            { label: 'Penceramah', href: '/admin/kuliah/ustaz.html',     match: ['/admin/kuliah/ustaz.html'] },
        ],
    },
    {
        key: 'infaq', label: 'Infaq', permission: 'infaq', requiresSuperAdmin: false,
        items: [
            { label: 'Ringkasan',    href: '/admin/infaq/ringkasan.html',    match: ['/admin/infaq/ringkasan.html'] },
            { label: 'Kutipan',      href: '/admin/infaq/kutipan.html',      match: ['/admin/infaq/kutipan.html'] },
            { label: 'Perbelanjaan', href: '/admin/infaq/perbelanjaan.html', match: ['/admin/infaq/perbelanjaan.html'] },
            { label: 'Projek',       href: '/admin/infaq/projek.html',
              match: ['/admin/infaq/projek.html', '/admin/infaq/projek-kutipan.html'] },
        ],
    },
    {
        key: 'news', label: 'Pengumuman', permission: 'news', requiresSuperAdmin: false,
        items: [
            { label: 'Pengumuman',    href: '/admin/news/pengumuman.html',     match: ['/admin/news/pengumuman.html'] },
            { label: 'Teks Berjalan', href: '/admin/news/teks-berjalan.html',  match: ['/admin/news/teks-berjalan.html'] },
        ],
    },
    {
        key: 'staff', label: 'Staf', permission: 'staff', requiresSuperAdmin: false,
        items: [
            { label: 'Senarai Staf', href: '/admin/staff/roster.html', match: ['/admin/staff/roster.html'] },
        ],
    },
    {
        key: 'khutbah', label: 'Khutbah', permission: 'khutbah', requiresSuperAdmin: false,
        items: [
            { label: 'Senarai Khutbah', href: '/admin/khutbah/senarai.html', match: ['/admin/khutbah/senarai.html'] },
        ],
    },
    {
        key: 'kalendar', label: 'Kalendar', permission: 'kalendar', requiresSuperAdmin: false,
        items: [
            { label: 'Takwim Islam', href: '/admin/calendar/senarai.html', match: ['/admin/calendar/senarai.html'] },
        ],
    },
    {
        key: 'pentadbiran', label: 'Pentadbiran', permission: null, requiresSuperAdmin: true,
        items: [
            { label: 'Pengguna',     href: '/admin/users.html',   match: ['/admin/users.html'] },
            { label: 'Log Aktiviti', href: '/admin/userlog.html', match: ['/admin/userlog.html'] },
        ],
    },
];

// The sidebar's chrome (topbar/backdrop/aside frame, an empty #sidebar-nav
// placeholder) is static HTML+CSS directly in each page (see admin/style.css'
// "Sidebar" section) — not JS-generated. It paints in the browser's normal
// blocking CSS pass, with no JS/CDN dependency, so there's nothing to wait
// on and nothing to flicker in. Only the actual module links below (which
// genuinely depend on the logged-in admin's permissions) are JS-rendered.

// Fills #sidebar-nav with the module groups from MODULES + currentAdmin.
// Called from requireKuliahAuth() once currentAdmin is populated. Rebuilds from
// scratch every call, so unlike the old _injectSuperAdminNav()'s per-link
// double-injection guard, this is naturally idempotent.
function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav || !currentAdmin) return;

    // vercel.json has cleanUrls: true, which REDIRECTS a request for
    // /admin/kuliah/jadual.html to the extensionless /admin/kuliah/jadual —
    // so on the real deploy, window.location.pathname never has a .html
    // suffix, even though every MODULES `match` entry is written with one
    // (matching this repo's own href/redirect convention everywhere else).
    // Strip .html from both sides before comparing so this works whether
    // the browser landed here with the extension (local python -m
    // http.server, which does NOT perform that redirect) or without it
    // (the live Vercel deploy) — this class of cleanUrls surprise is
    // invisible locally by construction, see CLAUDE.md's cleanUrls landmine.
    const path = window.location.pathname.replace(/\.html$/, '');
    // permission: null means "no specific module gate" — visible to any
    // authenticated admin (unless requiresSuperAdmin), e.g. the shared
    // Ringkasan overview link. Every other module still needs its own
    // truthy currentAdmin.permissions[permission] (or super_admin).
    const canSeeModule = (m) => currentAdmin.role === 'super_admin'
        ? true
        : (m.requiresSuperAdmin ? false : (m.permission === null || !!currentAdmin.permissions?.[m.permission]));

    nav.innerHTML = MODULES
        .filter(canSeeModule)
        .map(m => `
            <div class="sidebar-group">
                <div class="sidebar-group-label">${m.label}</div>
                ${m.items.map(item => {
                    const active = item.match.some(match => match.replace(/\.html$/, '') === path);
                    return `<a href="${item.href}" class="sidebar-link${active ? ' active' : ''}">${item.label}</a>`;
                }).join('')}
            </div>
        `).join('');

    // Full page navigation closes the drawer naturally on unload, but
    // closing explicitly avoids a visible flash of the open drawer during
    // a slow navigation.
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
}

// Off-canvas sidebar toggle (mobile, ≤768px — see admin/style.css). Desktop
// keeps the sidebar permanently visible (no transform applied at all above
// that breakpoint), so these are only ever meaningful below it.
function toggleNav() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (sidebar.classList.contains('open')) closeNav();
    else {
        sidebar.classList.add('open');
        document.getElementById('sidebar-backdrop')?.classList.add('open');
    }
}

function closeNav() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-backdrop')?.classList.remove('open');
}

// ─── Toast notifications ──────────────────────────────────────────────────────

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
}

function showToast(message, type = 'info', duration = 4000) {
    ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ─── Date / month utilities ───────────────────────────────────────────────────

const BULAN_MALAY = [
    'Januari','Februari','Mac','April','Mei','Jun',
    'Julai','Ogos','September','Oktober','November','Disember'
];
const HARI_MALAY = ['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];

function monthLabel(year, month) {
    return `${BULAN_MALAY[month - 1]} ${year}`;
}

function lastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Matches the "Bacaan Yasiin & Tahlil" special-case ustaz entry (also special-cased
// by name on the public kuliah/jadual/script.js page) regardless of Yasin/Yasiin spelling.
function isYasinEntry(ustaz) {
    if (!ustaz) return false;
    return /yasi+n/i.test(`${ustaz.short_name || ''} ${ustaz.full_name || ''}`);
}

function formatDateMY(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getDate()} ${BULAN_MALAY[d.getMonth()]} ${d.getFullYear()} (${HARI_MALAY[d.getDay()]})`;
}

// Exact day count since a plain DATE string (not a timestamp) — distinct
// from formatRelativeMY() (coarse minit/jam/hari/minggu/bulan buckets
// meant for recent timestamps like "last published"), this stays precise
// for a date that could be years in the past.
function daysSince(dateStr) {
    const ms = Date.now() - new Date(dateStr + 'T00:00:00').getTime();
    return Math.floor(ms / 86400000);
}

function formatDateTimeMY(iso) {
    const d = new Date(iso);
    // ms-MY emits PG/PTG day-periods — normalize to AM/PM admin-wide.
    return d.toLocaleString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        .replace(/\bPTG\b/g, 'PM').replace(/\bPG\b/g, 'AM');
}

function formatRelativeMY(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1)  return 'Baru sahaja';
    if (min < 60) return `${min} minit lalu`;
    const hr = Math.floor(min / 60);
    if (hr < 24)  return `${hr} jam lalu`;
    const day = Math.floor(hr / 24);
    if (day < 7)  return `${day} hari lalu`;
    const week = Math.floor(day / 7);
    if (day < 30) return `${week} minggu lalu`;
    const month = Math.floor(day / 30);
    return `${month} bulan lalu`;
}

// ─── Shared row-action icons ──────────────────────────────────────────────────
// Inline SVGs (pencil/trash), no emoji/font dependency. Buttons keep title +
// aria-label for a11y/tooltips. Same icons as admin/news/news-common.js's
// NEWS_ACTION_ICONS — defined here so every module can use them (news-common.js
// is only loaded on news pages).
const ACTION_ICONS = {
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    delete: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

// ─── XSS utility ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
