# TODO — Neon migration (remaining, kuliah DONE 2026-10-14)

Status: kuliah fully on Neon (data + Auth.js Google login + publish to `MAMTJ6/dev` + posters in repo).
Still on Supabase: **infaq, news, staff, khutbah, calendar** (+ old Supabase login on their pages).

## Per-module pattern (repeat for each)
1. `api/<module>.js` — ONE function: data CRUD on Neon (cookie session via `lib/db.js` `requireAdmin(req,'<perm>')`) + extend `api/kuliah.js?action=log` table whitelist if new log table.
2. Retarget its `api/publish-*.js`: Bearer Supabase JWT → `requireAdmin(req,'<perm>')`; Supabase REST → `await sql()\`...\``; `GITHUB_REPO=MAMTJ6/dev` (already set).
3. Frontend: add `<script src="/admin/kuliah/kuliah-api.js">` (shared `requireKuliahAuth/apiFetch-neonLog/uploadImage` — rename later, it is generic); replace `requireAuth()`→`requireKuliahAuth()`, `db.*`→`kuliahApi(...)` or new module endpoint, `logActivity()`→`neonLog()`, drop Bearer headers on publish fetches, Storage uploads→`uploadImage()`.
4. Posters/images still on Supabase URLs → move files into repo, UPDATE Neon URLs to repo paths (see §7 in Desktop/DEV_NOTES_MAMTJ6.md for kuliah SQL pattern).

## Order (smallest first)
- [x] calendar (log table only, no data table — easiest) — DONE 2026-10-14: `api/publish-events.js` on Neon cookie auth + `calendar_activity_log` insert; `api/kuliah.js` log whitelist + `last-published` table reader (all 6 log tables); `calendar-common.js`/`senarai.js`/`senarai.html` on `requireKuliahAuth`/`neonLog`/`kuliahApi`, Supabase CDN dropped. 12 functions, syntax + 21 tests pass.
- [x] staff (roster CRUD + `api/staff-login.js` rewrite; PIN hash logic in `staff-pin-pure.js` is reusable as-is) — DONE 2026-10-14: `api/staff-login.js` on Neon (`await sql()`, public PIN/Google paths unchanged, admin CRUD via `?action=list|save|delete|clear-lockout` with `requireAdmin(req,'staff')`, `has_pin` flag not hash); `roster.js` on `requireKuliahAuth`/`staffApi`/`neonLog`, Supabase CDN dropped from `roster.html`. Still 12 functions, syntax + 21 tests pass.
- [x] news (2 tables + settings + cron `publish-news`; note `kind='khutbah'` CSV fallback) — DONE 2026-10-14: `api/publish-news.js` on Neon (CRUD via `?action=`, publish via `?target=` cookie auth, cron Bearer unchanged, `tsStr()` Date→wall-string normalizer for pure builders, pure re-exports kept); `news-common.js`/`pengumuman.js`/`teks-berjalan.js` on `requireKuliahAuth`/`newsApi`/`neonLog`/`uploadImage('announcements')`, Supabase CDN dropped. Still 12 functions, syntax + all tests pass (`npm install` done, `.gitignore` added for node_modules).
- [x] khutbah (weeks + settings + Mon cron + Resend alerts) — DONE 2026-10-14: `api/publish-khutbah.js` on Neon (CRUD via `?action=list-weeks|save-week|toggle-lock|get-settings|save-setting`, publish POST cookie auth, cron GET unchanged, scrape/alert logic untouched, `dateStr()` DATE normalizer, pure re-exports kept); `api/khutbah-test-url.js` cookie auth; `khutbah-common.js`/`senarai.js` on `requireKuliahAuth`/`khutbahApi`/`neonLog`, Supabase CDN dropped. Still 12 functions, syntax + all tests pass.
- [x] infaq (4 tables, last — money data, test carefully) — DONE 2026-10-14: `api/publish-infaq.js` on Neon (CRUD via `?action=` incl. upserts on natural keys, server-side project totals/sums, publish `?target=` cookie auth, `dateStr()` DATE normalizer, NUMERIC-safe helpers verified with string inputs, pure re-exports kept); all 5 pages on `requireKuliahAuth`/`infaqApi`/`neonLog`, Supabase CDN dropped. Also fixed `last-published` param collision (`logAction`, affected calendar/news/khutbah notes). Still 12 functions, syntax + all tests pass.
- [x] dashboard.html (reads all modules — migrate after the above) — DONE 2026-10-15: kuliah glimpse via `kuliahApi('schedule'/'last-published')`, infaq glimpse via `infaqApi('list-kutipan'/'list-perbelanjaan'/'active-project')`, kalendar glimpse untouched (public JSON). Supabase CDN dropped.
- [x] Remove Supabase: `admin/app.js` supabase client — DONE 2026-10-15: `db`/`requireAuth`/`logActivity`/Supabase OAuth removed from `app.js` (`signInWithGoogle`→`/api/auth?action=login`, `signOut`→`?action=logout`); `admin/index.html` login via `/api/auth?action=me`; users/userlog/changelog on `requireKuliahAuth` (`users`+`logs` live in `api/auth.js`, super-admin enforced, self-delete blocked server-side, userlog gained Kalendar source + `publish_ustaz` label); all admin CDN script tags removed; `admin/setup.sql` → `admin/setup.sql.legacy`. No `process.env.SUPABASE_*` reads left in `api/`. REMAINING (you, in Vercel): delete `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` envs, then Redeploy newest deployment.

## Agent notes (learned 2026-10-13/14, do not re-learn)
- `await sql()\`...\`` — parens REQUIRED. `await sql\`...\`` returns the function itself (silent, no error until `.map`).
- Vercel Hobby: max 12 functions in `api/`. Count before adding (12 = full). Merge via `?action=` routers; tests live in `tests/`, never `api/`.
- Google OAuth redirect URI must match EXACTLY incl. `?action=callback`. App is in testing mode — new Gmail admins must be added under Audience > Test users.
- GitHub publish needs classic PAT (`repo` scope). Fine-grained PATs scoped to personal account can't see org repos.
- Neon DATE columns may arrive as Date objects — normalize to YYYY-MM-DD server-side (`api/kuliah.js#dateStr`).
- Vercel hides sensitive env values permanently — use `vercel env pull` or rotate. Env edits need Redeploy of the NEWEST deployment.
- `MAMTJ6/dev` is Public (Hobby blocks private org repos). Secrets only in Vercel env, never code.
- Neon connection: pooled string, Singapore region. Password was reset 2026-10-13 — old strings in chat history are dead.
