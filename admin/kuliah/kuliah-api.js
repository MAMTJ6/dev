// Neon-backed helpers for kuliah admin pages (jadual.js, ustaz.js).
// Replaces supabase-js `db.*` calls + app.js logActivity() for these pages
// ONLY — every other module still uses app.js + Supabase, untouched.
// Requires: /admin/app.js loaded first (renderSidebar, MODULES, toasts).

// New-session login. Sets app.js's `currentAdmin` global so
// requireModuleAccess()/canWriteModule()/renderSidebar() keep working as-is.
// Returns { email } or null (redirects to Google login on failure).
async function requireKuliahAuth() {
  let me = null;
  try {
    const res = await fetch('/api/auth?action=me');
    if (res.ok) me = await res.json();
  } catch (e) {
    me = null;
  }
  if (!me || !me.email) {
    window.location.replace('/api/auth?action=login&next=' + encodeURIComponent(window.location.pathname));
    return null;
  }
  currentAdmin = me;
  renderSidebar();
  return { email: me.email };
}

// GET /api/kuliah?action=... or POST JSON. Returns parsed JSON or throws.
async function kuliahApi(action, { method = 'GET', params = {}, body = null } = {}) {
  const q = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/kuliah?${q}`, {
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

// Fire-and-forget activity log (mirrors app.js logActivity: never throws).
async function neonLog(action, targetLabel, detail, table) {
  try {
    await kuliahApi('log', { method: 'POST', body: { action, target_label: targetLabel, detail, table } });
  } catch (e) {
    console.error('neonLog gagal:', e);
  }
}

// Identity/admin API (Neon, via /api/auth?action=... cookie session).
// users / save-user / delete-user / logs — super-admin only, server-enforced.
async function authApi(action, { method = 'GET', params = {}, body = null } = {}) {
  const q = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/auth?${q}`, {
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

// Upload one image File to the repo via /api/upload. Returns repo path.
async function uploadImage(folder, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const base64 = String(dataUrl).split(',')[1] || '';
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, filename: file.name, contentBase64: base64, contentType: file.type }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out.path;
}
