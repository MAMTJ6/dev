# TODO — Neon migration (remaining, kuliah DONE 2026-10-14)

Status: kuliah fully on Neon (data + Auth.js Google login + publish to `MAMTJ6/dev` + posters in repo).
Still on Supabase: **infaq, news, staff, khutbah, calendar** (+ old Supabase login on their pages).

## Per-module pattern (repeat for each)
1. `api/<module>.js` — ONE function: data CRUD on Neon (cookie session via `lib/db.js` `requireAdmin(req,'<perm>')`) + extend `api/kuliah.js?action=log` table whitelist if new log table.
2. Retarget its `api/publish-*.js`: Bearer Supabase JWT → `requireAdmin(req,'<perm>')`; Supabase REST → `await sql()\`...\``; `GITHUB_REPO=MAMTJ6/dev` (already set).
3. Frontend: add `<script src="/admin/kuliah/kuliah-api.js">` (shared `requireKuliahAuth/apiFetch-neonLog/uploadImage` — rename later, it is generic); replace `requireAuth()`→`requireKuliahAuth()`, `db.*`→`kuliahApi(...)` or new module endpoint, `logActivity()`→`neonLog()`, drop Bearer headers on publish fetches, Storage uploads→`uploadImage()`.
4. Posters/images still on Supabase URLs → move files into repo, UPDATE Neon URLs to repo paths (see §7 in Desktop/DEV_NOTES_MAMTJ6.md for kuliah SQL pattern).

## Order (smallest first)
- [ ] calendar (log table only, no data table — easiest)
- [ ] staff (roster CRUD + `api/staff-login.js` rewrite; PIN hash logic in `staff-pin-pure.js` is reusable as-is)
- [ ] news (2 tables + settings + cron `publish-news`; note `kind='khutbah'` CSV fallback)
- [ ] khutbah (weeks + settings + Mon cron + Resend alerts)
- [ ] infaq (4 tables, last — money data, test carefully)
- [ ] dashboard.html (reads all modules — migrate after the above)
- [ ] Remove Supabase: `admin/app.js` supabase client, CDN script tags, `SUPABASE_*` Vercel envs, old `setup.sql` → keep as `admin/setup.sql.legacy`

## Agent notes (learned 2026-10-13/14, do not re-learn)
- `await sql()\`...\`` — parens REQUIRED. `await sql\`...\`` returns the function itself (silent, no error until `.map`).
- Vercel Hobby: max 12 functions in `api/`. Count before adding (12 = full). Merge via `?action=` routers; tests live in `tests/`, never `api/`.
- Google OAuth redirect URI must match EXACTLY incl. `?action=callback`. App is in testing mode — new Gmail admins must be added under Audience > Test users.
- GitHub publish needs classic PAT (`repo` scope). Fine-grained PATs scoped to personal account can't see org repos.
- Neon DATE columns may arrive as Date objects — normalize to YYYY-MM-DD server-side (`api/kuliah.js#dateStr`).
- Vercel hides sensitive env values permanently — use `vercel env pull` or rotate. Env edits need Redeploy of the NEWEST deployment.
- `MAMTJ6/dev` is Public (Hobby blocks private org repos). Secrets only in Vercel env, never code.
- Neon connection: pooled string, Singapore region. Password was reset 2026-10-13 — old strings in chat history are dead.
