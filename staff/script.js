/* =========================================================
   Staff login — PIN or Google, both via /api/staff-login only.
   NEVER loads the Supabase JS SDK and NEVER calls db.auth.* — see
   api/staff-login.js's header comment for why that matters here
   specifically (staff must never become a Supabase Auth principal).
   ========================================================= */

// SETUP REQUIRED: paste the same Google OAuth Client ID the admin login
// already uses (Vercel env GOOGLE_CLIENT_ID for /api/auth, from Google
// Cloud Console → APIs & Services → Credentials). This value is NOT secret
// — Google Client IDs are meant to be public/client-side by design — but
// this file has no build step to inject it automatically, so it must be
// pasted in by hand, and MUST exactly match the GOOGLE_CLIENT_ID Vercel env
// var api/staff-login.js checks against, or every Google login will fail
// with "Log masuk Google tidak sah".
const GOOGLE_CLIENT_ID = '737196492802-bobgcpvase2741dker8lbmj21tce1rq5.apps.googleusercontent.com';

let allStaff = [];
let googleAvailable = false; // set true only once GIS is configured AND loaded

async function init() {
    await loadRoster();
    initGoogleSignIn();
    document.getElementById('staff-select').addEventListener('change', onStaffSelected);
    document.getElementById('pin-input').addEventListener('input', onPinInput);
}

async function loadRoster() {
    const select = document.getElementById('staff-select');
    try {
        const res = await fetch('/api/staff-login');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allStaff = data.staff || [];

        select.innerHTML = '<option value="">— Pilih nama anda —</option>' +
            allStaff.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)}</option>`).join('');
    } catch (e) {
        select.innerHTML = '<option value="">Gagal memuatkan senarai staf</option>';
        showError('Tidak dapat memuatkan senarai staf. Sila muat semula halaman ini.');
    }
}

function onStaffSelected() {
    const selectedId = document.getElementById('staff-select').value;
    const hasSelection = !!selectedId;
    document.getElementById('pin-group').style.display = hasSelection ? '' : 'none';
    document.getElementById('pin-submit-btn').style.display = hasSelection ? '' : 'none';

    // Google login isn't actually gated by staff_id server-side (it matches
    // by email), but showing the button for a name with no email on file
    // just leads to a confusing "akaun tidak didaftarkan" click — hide it
    // once such a name is picked. Leave it alone with no selection, since
    // Google login doesn't require picking a name at all.
    if (googleAvailable) {
        const staff = allStaff.find(s => s.id === selectedId);
        const showGoogle = !hasSelection || (staff && staff.has_email);
        document.querySelector('.login-divider').style.display = showGoogle ? '' : 'none';
        document.getElementById('g-signin-btn').style.display = showGoogle ? '' : 'none';
    }
    hideError();
}

function onPinInput(e) {
    // Numeric-only, 6 digits max — inputmode/pattern handle the mobile
    // keyboard hint, this is the actual enforcement.
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
}

async function submitPinLogin() {
    const staffId = document.getElementById('staff-select').value;
    const pin = document.getElementById('pin-input').value;
    hideError();

    if (!staffId) { showError('Sila pilih nama anda.'); return; }
    if (!/^\d{6}$/.test(pin)) { showError('PIN mestilah 6 digit.'); return; }

    const btn = document.getElementById('pin-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Log Masuk...';

    try {
        const res = await fetch('/api/staff-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'pin', staff_id: staffId, pin }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'PIN salah.');
            document.getElementById('pin-input').value = '';
            return;
        }

        onLoginSuccess(data);
    } catch (e) {
        showError('Ralat sambungan. Sila cuba lagi.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Log Masuk';
    }
}

function initGoogleSignIn() {
    if (GOOGLE_CLIENT_ID === 'REPLACE_WITH_GOOGLE_CLIENT_ID') {
        // Not configured yet — hide the button rather than show a broken
        // one. PIN login still works standalone either way.
        document.querySelector('.login-divider').style.display = 'none';
        document.getElementById('g-signin-btn').style.display = 'none';
        return;
    }
    if (typeof google === 'undefined' || !google.accounts) {
        // GIS script blocked/slow to load — PIN login still works standalone.
        return;
    }
    googleAvailable = true;
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onGoogleCredential,
    });
    google.accounts.id.renderButton(
        document.getElementById('g-signin-btn'),
        { theme: 'outline', size: 'large', text: 'signin_with', width: 280 }
    );
}

async function onGoogleCredential(response) {
    hideError();
    try {
        const res = await fetch('/api/staff-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'google', id_token: response.credential }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Log masuk Google gagal.');
            return;
        }

        onLoginSuccess(data);
    } catch (e) {
        showError('Ralat sambungan. Sila cuba lagi.');
    }
}

function onLoginSuccess(data) {
    localStorage.setItem('staff_device_session_token', data.token);
    localStorage.setItem('staff_id', data.staff.id);
    localStorage.setItem('staff_full_name', data.staff.full_name);

    document.getElementById('step-name').style.display = 'none';
    document.getElementById('success-name').textContent = data.staff.full_name;
    document.getElementById('step-success').style.display = '';
    // No clock-in UI yet — this is deliberately a stub landing state (see
    // staff/CLAUDE.md). The stored device_session_token is what a future
    // clock-in build will send with each action.
}

function showError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = '';
}

function hideError() {
    document.getElementById('login-error').style.display = 'none';
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

init();
