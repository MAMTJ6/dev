# Database — admin

_Moved here from `kuliah/admin/` on 2026-07-19 — see `admin/plan.md` and `admin/CLAUDE.md`._

Everything about the Supabase (PostgreSQL) database backing `admin/`: how to set it up from scratch, what's in it, how to maintain it, and how to fix it when something breaks.

The canonical setup script is [`setup.sql`](setup.sql) — this document explains *why* it's structured the way it is and walks through using it. **Never run parts of it blindly without reading what they do first** (per its own header comment).

**2026-10-24 Neon note (read first):** the backend has migrated off Supabase — canonical schema is now `admin/neon-schema.sql` (`setup.sql` kept as `setup.sql.legacy`). DB reads/writes go through `api/*.js` on Neon with a cookie session (`lib/db.js` `requireAdmin`); there is no RLS anymore, enforcement is server-side per module. Supabase is back only as Storage-only (new project, public buckets `posters`/`profiles`/`announcements`, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel) — `api/upload.js` uploads there and stores the public URL in Neon. Do NOT delete those two env vars (reverses `TODO-NEON.md`'s old "delete Supabase envs" instruction). The `kuliah-assets`/`news-assets` bucket docs in §2/§4 below describe the pre-Neon layout and are stale pending a full rewrite.

---

## 1. Setup from scratch

Follow these in order — each step depends on the one before it.

### 1.1 Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Note the **Project URL** and the **anon (publishable) key** (Project Settings → API) — the anon key goes in `admin/app.js` (`SUPABASE_URL`/`SUPABASE_ANON_KEY`, safe to expose in browser code, RLS enforces access control).
3. Note the **service_role key** separately — this is a secret, never put it in any file that gets committed. It only ever goes into a Vercel environment variable (see 1.4).

### 1.2 Run `setup.sql`

Open Supabase Dashboard → SQL Editor → New query, paste the entire contents of [`setup.sql`](setup.sql), and run it. This single script creates, in order:

1. **Tables** — `admins`, `ustaz`, `schedule` (§1)
2. **Indexes** on `schedule` for date/ustaz lookups (§2)
3. **RLS policies + explicit GRANTs** for all three tables (§3) — see [§3 RLS & permissions](#3-rls--permissions-the-part-thats-easy-to-get-wrong) below for why both are required
4. **Storage bucket** `kuliah-assets` for poster images, public-read/authenticated-write (§4)
5. **Google OAuth setup instructions** — manual steps, can't be done via SQL (§5)
6. **Bootstrap-the-first-super_admin instructions** — manual, one-time (§5b)
7. **Sample ustaz data** — commented out, optional (§6)
8. **`activity_log` table** + its own RLS/GRANTs (§7)
9. **Viewer role + write-gated RLS** (§9, added 2026-07-23) — extends the `role` CHECK, adds the `admin_can_write()`/`admin_is_super_admin()` helper functions, and replaces the single permissive policy on `admins`/`ustaz`/`schedule`/all 4 infaq tables with the SELECT-open/write-gated split described in [§3](#3-rls--permissions-the-part-thats-easy-to-get-wrong) — verify the `admins_role_check` constraint name first, per the comment at the top of §9

It's safe to re-run the whole script — every `CREATE TABLE`/`CREATE INDEX` uses `IF NOT EXISTS`, and bucket creation uses `ON CONFLICT DO NOTHING`. `CREATE POLICY` and `GRANT` are **not** idempotent the same way — re-running will error on `CREATE POLICY "name" already exists` if the policy is still there. That's expected and harmless; just skip that line if re-running after a partial failure.

### 1.3 Configure Google OAuth

Follow `setup.sql`'s §5 comment block:

1. Supabase Dashboard → Authentication → Providers → Google → enable it, paste your Google OAuth Client ID/Secret (create these at [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials).
2. Copy the Callback URL Supabase shows you, add it to your Google OAuth app's Authorised redirect URIs.
3. Supabase Dashboard → Authentication → URL Configuration → add your redirect URLs (`https://<your-domain>/admin/dashboard.html`, plus `http://localhost:8000/admin/dashboard.html` for local dev — `dashboard.html` is the OAuth `redirectTo` target as of 2026-07-22, replacing `admin/kuliah/jadual.html`).

### 1.4 Bootstrap the first super_admin

The `admins` table starts empty. But `users.html` — the page for adding admins — requires being logged in as a super_admin just to load. That's a chicken-and-egg problem the UI can't solve on its own. Break it with one manual insert, per `setup.sql` §5b:

```sql
INSERT INTO admins (email, name, role, permissions) VALUES
    ('your-email@gmail.com', 'Your Name', 'super_admin', '{"kuliah": true}'::jsonb);
```

The email must exactly match the Google account you'll log in with. After this one row exists, every other admin can be added normally through `users.html` — you never need to run this insert again.

### 1.5 Configure Vercel environment variables

`api/publish.js` needs these set in Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Same project URL as `app.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key from 1.1 — **never** put this in a committed file |
| `GITHUB_TOKEN` | Fine-grained PAT with `contents:write` on the target repo |
| `GITHUB_REPO` | e.g. `multimedia-mamtj6/dev` |

### 1.6 Verify

1. Serve the site locally (`python -m http.server` from repo root) or visit the deployed URL, open `admin/index.html`.
2. Log in with the Google account you bootstrapped in 1.4.
3. You should land on `dashboard.html` (the cross-module overview) with **both** "Pengguna" and "Log Aktiviti" visible in the sidebar (proves the `super_admin` role and `renderSidebar()`'s permission gating are both working).
4. Add a test ustaz on `ustaz.html`, assign them to a day on `jadual.html`, save — confirms `ustaz`/`schedule` writes work.
5. Check `userlog.html` shows the ustaz-create and day-edit rows you just made — confirms `activity_log` writes work.
6. `Terbitkan` only works where a Vercel serverless runtime actually runs `/api/publish` — it will fail locally with a connection-error toast, that's expected (see [Troubleshooting](#4-troubleshooting)).

### 1.7 Set up the infaq module (optional — separate from the kuliah setup above)

`admin/infaq/` (donation/expense tracking) is a second, independent module — skip this section entirely if you only need the lecture-schedule side. Its schema lives in `setup.sql` §8, run separately from §1-7 above:

1. In the Supabase SQL Editor, select and run `setup.sql` §8 in full (the `── 8. Infaq module ──` header through the end of that section) — **as one paste, not statement-by-statement.** Running it piecemeal can trip Supabase's own SQL Editor lint warning ("creates a table without enabling Row Level Security") on the `infaq_projects`/`infaq_kutipan_mingguan`/etc. `CREATE TABLE` statements individually, because the linter only sees the one statement you selected — it doesn't know the matching `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` exist later in the same section. Selecting and running the whole section together resolves this; the warning is a false alarm in that case, not a real gap.
2. **If your database already ran an earlier version of §8** (one that created `infaq_donations`/`infaq_expenses` — the per-row donation/expense model, replaced 2026-07-21 by the pre-aggregated tables in the current §8), don't re-run the whole section — `infaq_projects`/`infaq_activity_log`'s `CREATE POLICY` statements will error ("already exists," Postgres has no `IF NOT EXISTS` for policies). Run only the three new `CREATE TABLE` blocks (`infaq_kutipan_mingguan`/`infaq_projek_kutipan`/`infaq_perbelanjaan_bulanan`) plus their own indexes/RLS/policies/grants, then run §8b (next step) to clean up the old tables.
3. Run §8b (`DROP TABLE IF EXISTS infaq_donations, infaq_expenses`) — only relevant if step 2 applied to you; safe no-op otherwise. **Irreversible** — check Supabase's Table Editor first if those tables might hold real data you want to keep.
4. Optional: `admin/import-legacy-infaq-data.sql` bulk-imports historical donation/expense data transcribed from a Sheet — see that file's own header comment before running it (Section C, the project + its donations, is **not** idempotent — running it twice creates duplicate rows).
5. In `users.html`, grant `permissions.infaq` to whichever admins need it (unlike `permissions.kuliah`, this defaults to `false` on new rows — see [§2](#admins) below).
6. Verify: log in as an admin with `permissions.infaq`, confirm the "Infaq" nav links appear and `ringkasan.html` loads without a denied-redirect. Add a test row on `kutipan.html`, confirm it appears in Supabase's Table Editor.

No new Vercel environment variables are needed — `api/publish-infaq.js` reuses the same `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GITHUB_TOKEN`/`GITHUB_REPO` from [1.5](#15-configure-vercel-environment-variables).

### 1.8 Set up the news module (optional — separate from kuliah/infaq above)

`admin/news/` (CMS for `news/`'s Xibo digital-signage displays) is a third, independent module — skip this section if you don't need it. Its schema lives in `setup.sql` §10, written directly against the write-gated §9 model (no old-style open-policy step to migrate through, since this module was added after §9 already existed):

1. In the Supabase SQL Editor, select and run `setup.sql` §10 in full (`── 10. News module ──` through the end of that section), as one paste — same "run RLS-enable and policies together" reasoning as §8's infaq note above.
2. Set the **`CRON_SECRET`** Vercel environment variable (see [1.9](#19-configure-the-news-module-cron) below) — required before the daily ticker/announcement republish cron can run, and `api/publish-news.js` fails closed (rejects every cron request) without it.
3. In `users.html`, grant `permissions.news` to whichever admins need it (defaults to `false` on new rows, same opt-in shape as `permissions.infaq`).
4. Verify: log in as an admin with `permissions.news`, confirm the "Pengumuman" nav group appears with both "Pengumuman" and "Teks Berjalan" links. Add a test row on either page, confirm it appears in Supabase's Table Editor, then click Terbitkan and confirm a new commit lands on `news/data/announcements.json` or `news/data/moving-text.json`.
5. Optional: if you want the auto-sourced khutbah ticker line, add one `news_ticker` row with `kind = 'khutbah'` and a `prefix` (e.g. `'Khutbah Jumaat Minggu Ini: '`) via `teks-berjalan.html` — `khutbah_csv_url` is already seeded in `news_settings` pointing at the same published CSV `khutbah/index.html` reads.

No new Supabase-side Vercel environment variables beyond `CRON_SECRET` — `api/publish-news.js` reuses the same `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GITHUB_TOKEN`/`GITHUB_REPO` from [1.5](#15-configure-vercel-environment-variables).

### 1.9 Configure the news module cron

`vercel.json`'s `crons` array hits `GET /api/publish-news` once a day (`0 20 * * *` = 20:00 UTC = 04:00 MYT, before Subuh). Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on cron-triggered requests when a `CRON_SECRET` project environment variable is set — that's Vercel's own convention, not a custom header this repo invented. Set `CRON_SECRET` to any random secret string in Vercel Dashboard → Project → Settings → Environment Variables; no matching client-side value is ever needed since only Vercel's own cron infrastructure calls the GET path. **Until `CRON_SECRET` is set, the cron path fails closed with a 500 on every attempt** — this doesn't block the admin's own POST-based Terbitkan buttons, which use a Supabase session token instead and work regardless.

### 1.10 Set up the staff module (optional — separate from every module above)

`admin/staff/` + `staff/` (the identity/login layer for a future geolocation clock-in feature — see `admin/CLAUDE.md`'s "What this is") is a fourth, independent module — skip this section if you don't need it yet. Its schema lives in `setup.sql` §11.

1. In the Supabase SQL Editor, select and run `setup.sql` §11 in full (`── 11. Staff identity/login module ──` through the end of that section), as one paste.
2. In `users.html`, grant `permissions.staff` to whichever admins need it (defaults to `false` on new rows, same opt-in shape as `permissions.infaq`/`permissions.news`).
3. **Set the `GOOGLE_CLIENT_ID` Vercel environment variable** — the same Google OAuth Client ID Supabase Auth already uses for admin login (find it in Supabase Dashboard → Authentication → Providers → Google, or Google Cloud Console → Credentials). Not secret, but required — `api/staff-login.js` fails Google logins without it.
4. **Paste that exact same Client ID into `staff/script.js`'s `GOOGLE_CLIENT_ID` constant by hand** — this repo has no build step to inject it automatically. Until this is done, `staff/index.html` (served at `/staff`) hides the Google Sign-In button entirely (PIN login still works) rather than showing a broken one.
5. **Add `staff/index.html`'s (`/staff`) origins to Google Cloud Console → APIs & Services → Credentials → [the OAuth Client] → Authorized JavaScript origins** — your production domain, and `http://localhost:8000` if testing locally. **This is a different setting than step 3 of [1.3](#13-configure-google-oauth)** (Supabase's own Redirect URLs) — the staff login flow uses Google Identity Services directly, never `signInWithOAuth()`, so it needs this origin allowlist instead, not a redirect URL.
6. Add at least one test staff member via `admin/staff/roster.html`, click "Jana PIN Baharu", note the revealed PIN. Verify: open `staff/index.html` (`/staff`), pick that name from the list, enter the PIN, confirm the stub "Log Masuk Berjaya" success state appears. Deliberately fail the PIN 5 times to confirm the lockout message appears, then use "Buka Kunci" in `roster.html` to clear it.

No new Supabase-side Vercel environment variables beyond `GOOGLE_CLIENT_ID` — `api/staff-login.js` reuses the same `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from [1.5](#15-configure-vercel-environment-variables). Unlike every other module, this one has **no GitHub token / Terbitkan step at all** — there's nothing to publish, `staff` is a live table read directly by `api/staff-login.js`, not a source for a static JSON snapshot.

### 1.11 Set up the khutbah module (optional — separate from every module above)

`admin/khutbah/` (Mimbar Jumaat weekly-sermon automation, retiring the Google Sheet → Apps Script → CSV pipeline — see `khutbah/upgrade-plan.md`) is a fifth, independent module. Skip this section if you don't need it. Its schema lives in `setup.sql` §12, written directly against the write-gated §9 model like §10/§11.

1. In the Supabase SQL Editor, select and run `setup.sql` §12 in full (the `-- ── 12. Khutbah module ──` header through the end of the file), **as one paste — §12 only, not the whole file.** Re-running earlier sections fails on `CREATE POLICY ... already exists` (Postgres has no `IF NOT EXISTS` for policies) and rolls the whole paste back — that error means wrong paste range, not a real problem.
2. Verify: `SELECT tablename FROM pg_tables WHERE tablename LIKE 'khutbah%';` → 3 rows (`khutbah_weeks`, `khutbah_settings`, `khutbah_activity_log`); `SELECT key, value FROM khutbah_settings;` → 4 seeded rows.
3. In `users.html`, grant `permissions.khutbah` to whichever admins need it (defaults to `false` on new rows, same opt-in shape as infaq/news/staff).
4. **Set the `RESEND_API_KEY` Vercel environment variable** (Resend → API Keys → copy `re_...`). Without it, publishes still succeed but failure alerts are logged as `alert_skipped_no_key` instead of mailed. No new Supabase/GitHub vars — `api/publish-khutbah.js` reuses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GITHUB_TOKEN`/`GITHUB_REPO` from [1.5](#15-configure-vercel-environment-variables), and the Mon-9am cron reuses the same `CRON_SECRET` as the news cron ([1.9](#19-configure-the-news-module-cron)).
5. **Verify the sender domain in Resend** (Domains → Add `mamtj6.com` → paste the TXT records into your DNS → Verify). The alert sender (`khutbah_settings.alert_from`, seeded `noreply@mamtj6.com`) **must** be on this verified domain — Resend cannot send from free providers, so a gmail.com sender fails. Recipients (`alert_emails`, comma-separated) have no such restriction.
6. Verify: open `admin/khutbah/senarai.html`, fill the Tetapan card (`alert_emails`, confirm `alert_from`), click **Jana & Terbitkan**, confirm a `[Admin] Terbitkan khutbah` commit lands on `khutbah/data/khutbah.json` and `khutbah/index.html` (served at `/khutbah/`) renders it instead of TIADA DATA.

### 1.12 Set up the kalendar module (optional — separate from every module above)

`admin/calendar/` (Takwim Islam dates → `calendar/hijri/data/events.json`, retiring the standalone PIN page) is a sixth, independent module. Skip this section if you don't need it. Its schema lives in `setup.sql` §13: one table only (`calendar_activity_log`, open FOR ALL like every other log table — no data table, `events.json` on GitHub stays the single source of truth).

1. In the Supabase SQL Editor, select and run `setup.sql` §13 in full (`── 13. Kalendar module ──` through the end of the file), **as one paste — §13 only, not the whole file** (same `CREATE POLICY ... already exists` rollback risk as §12, see [1.11](#111-set-up-the-khutbah-module-optional--separate-from-every-module-above)).
2. Verify: `SELECT tablename FROM pg_tables WHERE tablename LIKE 'calendar%';` → 1 row (`calendar_activity_log`).
3. In `users.html`, grant `permissions.kalendar` to whichever admins need it (defaults to `false` on new rows, same opt-in shape as every other module).
4. No new Vercel env vars — `api/publish-events.js` reuses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GITHUB_TOKEN`/`GITHUB_REPO` from [1.5](#15-configure-vercel-environment-variables). Delete the now-dead `EVENTS_ADMIN_PIN` var left over from the retired PIN page.
5. Verify: open `admin/calendar/senarai.html`, edit a row, click **Simpan & Terbitkan**, confirm a `[Admin] Kemas kini tarikh penting` commit lands on `calendar/hijri/data/events.json`.

---

## 2. Database structure

Four kuliah tables + four infaq tables (§2.1 below) + four news tables (§2.2 below) + three khutbah tables (`khutbah_weeks`, `khutbah_settings`, `khutbah_activity_log` — full column reference lives in `admin/CLAUDE.md`'s Supabase Schema, not yet duplicated into a §2.x section here) + one kalendar log table (`calendar_activity_log`, same shape, `setup.sql` §13), one storage bucket per module (`kuliah-assets`, `news-assets`; khutbah and kalendar have no bucket). No triggers, no stored procedures, no views — every table is written to directly from `admin/*.js` (and the activity-log tables also from their respective `api/publish*.js` server-side). This repo has **zero** database-side logic beyond RLS/GRANTs (and the `admin_can_write()`/`admin_is_super_admin()` `SECURITY DEFINER` helper functions, §3); all business logic lives in the client JS.

```
admins ──────────────┐
  (who can log in)    │ (actor_email/actor_name — plain text, NOT a FK)
                       ▼
                 activity_log
                       ▲
  (subuh/maghrib_ustaz_id — FK, ON DELETE SET NULL)
ustaz ◄──────────── schedule
  (penceramah)         (one row per date)
```

infaq's tables are documented separately in [§2.1](#21-infaq-tables) — independent of the diagram above, they don't reference `ustaz`/`schedule` at all.

### `admins`

Who's allowed to log in, and what they can do. Checked by `app.js`'s `requireAuth()` after every Google OAuth login — an email not in this table gets signed out immediately and redirected to `index.html?denied=1`.

```sql
id          UUID PK
email       TEXT UNIQUE NOT NULL   -- must match the Google account exactly
name        TEXT                  -- display name, shown in nav/logs
role        TEXT NOT NULL DEFAULT 'editor'  CHECK ('editor' | 'super_admin' | 'viewer')
permissions JSONB NOT NULL DEFAULT '{"kuliah": true, "infaq": false}'
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- `role = 'editor'` — can edit schedule + ustaz. `role = 'super_admin'` — also gets `users.html` (manage admins) and `userlog.html` (activity log). `role = 'viewer'` (added 2026-07-23) — can see whichever modules `permissions` grants, exactly like an editor, but can never write anywhere (Add/Edit/Delete/Terbitkan), in any module, regardless of `permissions`. Orthogonal axes: `role` decides *can they write at all*, `permissions` decides *which modules can they see*.
- `permissions` is a per-module flag object — `{ kuliah: bool, infaq: bool }` as of the infaq module (2026-07-19). `kuliah` defaults `true` (opt-out), `infaq` defaults `false` (opt-in) — set per-admin in `users.html`. **As of 2026-07-23, both `permissions.kuliah` and `permissions.infaq` are enforced** — `requireModuleAccess(moduleKey)` (`app.js`, `requireInfaqAccess()` is now a wrapper around it) gates page visibility for both modules, and real RLS policies (§3) gate writes at the database level. Before that date, `permissions.kuliah` was schema-only with no gate anywhere — see `DEV_NOTES.MD` for that history.
- No `updated_at` column (unlike the other three tables) — nobody has needed to know when an admin's role last changed. If that becomes important, add it the same way `ustaz`/`schedule` have theirs.

### `ustaz`

The penceramah (lecturer) registry.

```sql
id           UUID PK
short_name   TEXT UNIQUE NOT NULL   -- shown everywhere in the UI (dropdowns, pills, log)
full_name    TEXT NOT NULL          -- used in published JSON, formal contexts
tajuk_kuliah TEXT                   -- lecture topic, optional
jawatan      TEXT                   -- role/title shown on the public directory, optional (added 2026-09-12)
poster_url   TEXT                   -- Supabase Storage public URL, optional (landscape, ~1920x1080 convention)
square_url   TEXT                   -- square-ratio poster variant, any resolution, optional (added
                                     -- 2026-07-29 — no live consumer yet, same upload-or-URL pattern)
profile_url  TEXT                   -- mugshot portrait, optional (added 2026-09-12, `profiles/` prefix,
                                     -- shown on kuliah/penceramah/)
is_public    BOOLEAN NOT NULL DEFAULT true  -- show in the public directory (added 2026-09-12;
                                     -- false rows are dropped server-side by api/publish-ustaz.js,
                                     -- NULL (pre-flag rows) counts as public)
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- `short_name` is `UNIQUE` — this is what breaks if you try to add two ustaz with the same short name (see [Troubleshooting](#4-troubleshooting)).
- Sort order is **never** done via Supabase `.order('short_name')` — Postgres sorts that lexicographically (`"Ustaz 10"` before `"Ustaz 2"`), not numerically. Every page that lists ustaz sorts client-side with `localeCompare({ numeric: true })` instead. Don't add `.order()` back.
- Deleting a row is blocked in the UI (`ustaz.js`'s `confirmDelete()`) if the ustaz is still referenced in any `schedule` row — but nothing stops that check being bypassed by direct SQL, so the FK's `ON DELETE SET NULL` (below) is the real safety net.
- Poster files uploaded to Storage are **not** cleaned up when a poster is replaced or removed — old files are simply orphaned in the `kuliah-assets` bucket. Known gap, see [Maintenance](#3-maintenance). Applies equally to `square_url` files (`posters-square/` prefix, same bucket) and `profile_url` mugshots (`profiles/` prefix, same bucket).
- `square_url` is independent of `poster_url` — either, both, or neither can be set. `ustaz.js`'s save logic for it is a parallel copy of `poster_url`'s 3-way (remove/new-value/unchanged), not shared code — see `admin/CLAUDE.md` Key Patterns. `profile_url` (mugshot, added 2026-09-12) follows the exact same parallel-3-way pattern for the same reason.

### `schedule`

One row per calendar date — the actual lecture schedule.

```sql
id               UUID PK
date             DATE UNIQUE NOT NULL
subuh_ustaz_id   UUID REFERENCES ustaz(id) ON DELETE SET NULL
maghrib_ustaz_id UUID REFERENCES ustaz(id) ON DELETE SET NULL
subuh_pending    BOOLEAN NOT NULL DEFAULT false   -- "Belum Ditetapkan" — see note below
maghrib_pending  BOOLEAN NOT NULL DEFAULT false
subuh_khas       BOOLEAN NOT NULL DEFAULT false   -- "Kuliah Khas" — see note below, added 2026-07-25
maghrib_khas     BOOLEAN NOT NULL DEFAULT false
subuh_ditangguhkan   BOOLEAN NOT NULL DEFAULT false   -- "Ditangguhkan" — see note below, added 2026-09-27
maghrib_ditangguhkan BOOLEAN NOT NULL DEFAULT false
cuti_umum        TEXT              -- public holiday label, optional
created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- `date` is `UNIQUE` — every write from the dashboard is an `upsert` keyed on `date` (`onConflict: 'date'`), never a plain insert.
- `ON DELETE SET NULL` on both ustaz FKs — if an ustaz row is ever deleted (bypassing the UI guard above), any schedule row that referenced them just goes back to "Tiada Kuliah" instead of erroring or cascading a delete.
- **`subuh_pending`/`maghrib_pending` (added session 8) are mutually exclusive with their matching `*_ustaz_id`** — `jadual.js`'s `saveDay()` forces the ustaz id to `null` whenever its pending checkbox is checked, so a slot is never both "assigned" and "pending" at once. Used for a slot known to be happening but whose speaker/topic isn't decided yet ("Belum Ditetapkan") — publishing writes `{ pending: true }` for that slot instead of an ustaz object or `null`. **Not Khas-specific** — despite originally being motivated by Khas days, this flag applies to any pending session; see the next bullet for the actual Khas concept.
- **`subuh_khas`/`maghrib_khas` (added 2026-07-25) mark a session as a special "Kuliah Khas" lecture — independent of, and NOT mutually exclusive with, `*_pending`.** A Khas day can have a confirmed ustaz assigned, or be pending with no speaker decided yet — both are valid combinations, which is why this is a separate flag rather than folded into `*_pending`. Set via a checkbox in `jadual.js`'s day-editor modal, doesn't disable/clear the ustaz select (unlike the pending checkbox). `api/publish.js` merges `khas: true` onto whichever of the 3 existing session shapes (`{pending:true}`, an ustaz object, or `null`) already applies. On the public page, this changes the session label to "Kuliah Subuh/Maghrib Khas", colors the day cell purple, and — only on a month that actually has one — adds a "KULIAH KHAS" legend entry. See `kuliah/CLAUDE.md` for the public-page rendering details.
- **`subuh_ditangguhkan`/`maghrib_ditangguhkan` (added 2026-09-27, admin-only so far) mark a scheduled slot as postponed — keeps the assigned ustaz (same pattern as `*_khas`, NOT the pending-clears-select pattern).** MAY combine with Khas, MUST NOT combine with Pending (a pending slot has no speaker to postpone — enforced both directions in the modal: checking one unchecks+disables the other). Admin calendar shows the kept name + "(Ditangguhkan)" in red (`session-tag ditangguhkan` / `mdc-ditangguhkan`, stacks with khas/yasin classes). Salin Data does NOT copy it forward (date-specific incident, same rationale as `cuti_umum` — `confirmDuplicate()` only copies ustaz IDs). Publish merges `ditangguhkan: true` (`api/publish.js`); public `kuliah/jadual/` (name + red `DITANGGUHKAN` status, legend) + `kuliah/paparan/` (dimmed poster + overlay) both render it — see `kuliah/CLAUDE.md`.
- Month navigation in `jadual.js` is unrestricted (any past/future month), but only the **real current** and **real next** calendar month can ever be published (`api/publish.js` rejects any other `month` param) — editing further out is for early planning only.

### `activity_log`

Accountability changelog — who changed what, when. Added later than the other three tables; see [`developer.md`](developer.md)'s "Activity log" section for the full design rationale.

```sql
id           UUID PK
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
actor_email  TEXT NOT NULL
actor_name   TEXT
action       TEXT NOT NULL   -- schedule_day_edit | schedule_duplicate | schedule_clear |
                             -- ustaz_create | ustaz_update | ustaz_delete |
                             -- admin_create | admin_update | admin_delete | publish
target_label TEXT            -- human-readable snapshot: a date, an ustaz short_name, an email, a month
detail       TEXT            -- human-readable before→after diff, or a summary for bulk actions
```

- **`actor_email`/`actor_name`/`target_label` are always plain-text snapshots taken at the moment of the action — never a foreign key to `admins`/`ustaz`/`schedule`.** This is deliberate: those rows can be renamed or hard-deleted later, and the log must stay readable regardless. If you're tempted to "normalize" this into a proper FK relationship, don't — that's the one design decision in this table that must not change.
- Written by `logActivity()` in `app.js` (every browser write) and separately by `api/publish.js` (server-side, for the `publish` action, using the service_role key).
- No `updated_at` and no `UPDATE`/`DELETE` code path exists anywhere in the app for this table — it's meant to be append-only. The `GRANT` includes `UPDATE`/`DELETE` for admin flexibility (e.g. manual cleanup via SQL Editor), but nothing in the UI ever calls it.
- Row count grows unboundedly over time but stays cheap at this app's realistic scale (a single mosque, a handful of admins) — `idx_activity_log_created_at` keeps the common "recent activity" queries fast regardless. See [Maintenance](#3-maintenance) if this ever needs revisiting.

### Storage: `kuliah-assets` bucket

Public bucket for ustaz poster images. Public read (anyone can view a poster URL), authenticated-only write/update/delete. Upload path convention: `posters/{safe-short-name}-{timestamp}.{ext}` for the landscape poster, `posters-square/{safe-short-name}-{timestamp}.{ext}` for the square variant (added 2026-07-29) — same bucket, same RLS (gated on `bucket_id` only, no path-prefix policy), see `ustaz.js`'s `saveUstaz()`.

---

## 2.1 Infaq tables

Independent of the kuliah tables above — no foreign keys cross between the two groups, `infaq_projects` is the only table any of the others below reference. Added 2026-07-19, **rebuilt from scratch 2026-07-21** after comparing the original design against the mosque's real recording pattern (the live Sheet/JSON behind their separate, older `infaq.mamtj6.com` site) and finding it didn't match — see `DEV_NOTES.MD` session 11 for the full story. Nothing from the original design was ever run against live Supabase, so this was a clean rebuild, not a migration.

```
infaq_projects
    ▲ (project_id — FK, NOT NULL)
infaq_projek_kutipan

infaq_kutipan_mingguan          infaq_perbelanjaan_bulanan
  (no FK to anything)              (no FK to anything)
```

### `infaq_projects`

Named fundraising campaigns with a target (e.g. a building fund). History is kept — rows are never overwritten when a project ends, only `is_active` flips.

```sql
id            UUID PK
name          TEXT NOT NULL
target_amount NUMERIC(12,2) NOT NULL CHECK (> 0)
is_active     BOOLEAN NOT NULL DEFAULT false
completed_at  TIMESTAMPTZ
launch_date   DATE                -- optional, added 2026-07-23 (session 13)
online_total             NUMERIC(12,2)  -- optional, added 2026-07-24
online_total_updated_at  DATE           -- optional, added 2026-07-24
created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- **At most one active project at a time**, enforced by a partial unique index (`idx_infaq_projects_one_active`, `ON is_active WHERE is_active = true`). `admin/infaq/projek.js`'s "Jadikan Aktif" action must deactivate the currently-active project (setting `completed_at`) **before** activating the target — two sequential `UPDATE`s, always in that order, so the index is never transiently violated by two concurrently-true rows.
- New projects are always created `is_active: false` — activating is a separate, explicit step, so drafting a new project can never silently deactivate whatever's currently live.
- General/unearmarked infaq (`infaq_kutipan_mingguan`) never touches this table — only donations explicitly recorded against a project (`infaq_projek_kutipan`) count toward `JumlahTerkumpul`.
- **`launch_date` (session 13, 2026-07-23)** — optional, filled in per-project via `projek.html`'s Edit modal, never backfilled via SQL. Exists because `infaq_projek_kutipan.jumlah` has a `CHECK (> 0)` constraint that blocks recording a real historical RM0 "launch marker" entry as a donation row — this field is the alternative home for that date. Drives `admin/infaq/projek-kutipan.js`'s "`X` hari sejak dilancarkan" display (`daysSince()` in `app.js`) — hidden entirely, not shown as a placeholder, when unset.
- **`online_total`/`online_total_updated_at` (2026-07-24)** — a second, non-itemized donation channel (direct bank transfers) that `infaq_projek_kutipan` structurally can't represent (that table is one row per physical-tabung deposit). Single overwritable figure + its own "last checked against the bank statement" date, same shape as `launch_date` — but edited from `admin/infaq/projek-kutipan.html`'s own quick-edit modal (the project detail page, where the figure is actually displayed), not `projek.html`'s project-settings modal. **Every "Terkumpul" computation in the codebase adds this on top of the summed `infaq_projek_kutipan` rows** — `projek.js`, `projek-kutipan.js`, `ringkasan.js`, `admin/dashboard.js`, and `api/publish-infaq.js`'s `computeProjectProgress()` — so the published `daily.json`/`data.json` and every admin-side view always agree. Treated as `0` wherever read if `NULL`. See `admin/CLAUDE.md`'s Key Patterns for the full reconciliation story (RM 176,314 physical + RM 20,427 online = RM 196,741, matching the reference site exactly).

### `infaq_kutipan_mingguan`

General infaq (tabung Jumaat/harian) — **one row per week actually collected**, not per donor. This matches how the committee really records it: a single lump sum per week, exactly like the Sheet this schema was designed against.

```sql
id         UUID PK
tahun      INTEGER NOT NULL
bulan      INTEGER NOT NULL CHECK (1-12)
minggu     INTEGER NOT NULL CHECK (1-5)
jumlah     NUMERIC(12,2) NOT NULL CHECK (> 0)
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (tahun, bulan, minggu)
```

- **Sparse by design** — a week with nothing collected simply has no row (matching the source Sheet's "-" cells), never a stored zero. Every rollup (`JumlahBulanan`, yearly `graf`, `ringkasan` totals) is computed by `api/publish-infaq.js`, never typed in.
- `admin/infaq/kutipan.js` writes via **upsert** on `(tahun, bulan, minggu)`, not plain insert — recording an already-existing week replaces its total rather than erroring, matching the real workflow (the committee just records "this week's number," they shouldn't need to check whether it already exists).

### `infaq_projek_kutipan`

Individual dated donations earmarked to ONE project — the only infaq table that's genuinely per-deposit, because that's how the real project ("Tabung Bangunan Tambahan MAMTJ6") is actually tracked in the source data.

```sql
id         UUID PK
project_id UUID NOT NULL REFERENCES infaq_projects(id)
tarikh     DATE NOT NULL
jumlah     NUMERIC(12,2) NOT NULL CHECK (> 0)
keterangan TEXT
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- `project_id` is `NOT NULL` — general, unearmarked infaq lives in `infaq_kutipan_mingguan` instead, never here.
- No `ON DELETE CASCADE` on the FK — `admin/infaq/projek.js`'s `confirmDelete()` blocks deleting a project while any donation still references it (a client-side guard; direct SQL could still bypass it, at which point the delete would simply fail on the FK constraint rather than silently orphaning rows).
- No unique constraint — legitimate same-day duplicate donations exist in the real data (e.g. the tabung emptied twice in one collection run), so don't add one.
- Edited via `admin/infaq/projek-kutipan.html?project=<id>` — reached by clicking "Lihat Kutipan" on a project's row in `projek.html`, not a standalone nav link.

### `infaq_perbelanjaan_bulanan`

Mosque expenses — **one row per month total**, not per bill/receipt. The real Sheet never tracked category or description per expense, only a monthly lump sum, so this matches exactly (a deliberate simplification from the original per-expense design).

```sql
id         UUID PK
tahun      INTEGER NOT NULL
bulan      INTEGER NOT NULL CHECK (1-12)
jumlah     NUMERIC(12,2) NOT NULL CHECK (> 0)
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (tahun, bulan)
```

- Same sparse-by-design + upsert-on-conflict pattern as `infaq_kutipan_mingguan`, just keyed on `(tahun, bulan)` only (no `minggu`).

### `infaq_activity_log`

A **separate** table from `activity_log` (kuliah's) — deliberate choice for independent auditability on money data. Otherwise identical shape/reasoning to `activity_log` above.

```sql
id           UUID PK
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
actor_email  TEXT NOT NULL
actor_name   TEXT
action       TEXT NOT NULL  -- infaq_kutipan_mingguan_create/update/delete |
                             -- infaq_projek_kutipan_create/update/delete |
                             -- infaq_perbelanjaan_create/update/delete |
                             -- infaq_project_create/update/delete/activate |
                             -- publish_monthly | publish_daily | publish_perbelanjaan | publish_project
target_label TEXT
detail       TEXT
```

- `userlog.html` merges this into the same timeline as `activity_log`/`news_activity_log` (fixed 2026-07-22 for infaq, extended 2026-07-28 for news) — see `userlog.js`'s `LOG_SOURCES` array.
- Written by `logActivity(action, targetLabel, detail, 'infaq_activity_log')` — `app.js`'s shared `logActivity()` gained an optional 4th param (table name, defaults to kuliah's `activity_log`) specifically so infaq pages could reuse it without duplicating the function.
- **`publish_monthly`/`publish_daily`/`publish_perbelanjaan`/`publish_project` are distinct actions, not one shared `publish`** — `api/publish-infaq.js` publishes each of its output files independently (`?target=monthly|daily|perbelanjaan`, plus `?target=project&project=<uuid>` for the per-project file added 2026-09-07), each logging its own row so `kutipan.html`/`perbelanjaan.html`/`projek-kutipan.html` can each show their own "last published" note next to their own Terbitkan button (moved off `ringkasan.html` the same day — see `admin/CLAUDE.md`'s Key Patterns). **`publish_project` rows all share the same action but differ by `target_label = <project.name>`** — so `projek-kutipan.html`'s per-project note must query by both `action='publish_project'` AND `target_label = current project's name` (see `loadLastPublishedProjectNote()` in `projek-kutipan.js`), unlike the three fixed-name actions which are each unique by action alone.

---

## 2.2 News tables

Independent of both the kuliah and infaq tables above. Added 2026-07-28, retiring the old Google Sheet → Apps Script → GitHub pipeline (`news/moving-text/code.gs`) — see `admin/CLAUDE.md`'s "What this is" for why (the unvalidated `"ERROR: ... Status: 503"` incident).

```
news_announcements (no FK to anything)      news_ticker (no FK to anything)
news_settings (key/value, no FK)            news_activity_log (no FK, plain-text snapshots only)
```

### `news_announcements`

One row per Pengumuman slide. Read by `news/script.js`, which resolves the active `start_at`/`end_at` window **client-side**, on the display device's own clock — so this table's rows are published essentially as-is (only `enabled = false` rows are dropped), future/expired ones included.

```sql
id         UUID PK
title      TEXT NOT NULL      -- internal label, also published as JSON "title"
heading    TEXT
body_text  TEXT               -- maps to published JSON "text"
image_url  TEXT
start_at   TIMESTAMP          -- day+hour+minute, changed from DATE 2026-07-28 — see note below
end_at     TIMESTAMP
enabled    BOOLEAN NOT NULL DEFAULT true
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
CHECK (image_url IS NOT NULL OR body_text IS NOT NULL)
```

- The `CHECK` constraint mirrors `news/script.js`'s `isActive()`: an entry with neither an image nor text can never actually display anything, so it's rejected at the database rather than allowed to publish as a blank slide.
- Images are uploaded to the `news-assets` Storage bucket (see below) or entered as a URL — same mutually-exclusive upload-or-URL pattern as `ustaz.poster_url`, reusing `ustaz.js`'s save logic verbatim (`admin/news/pengumuman.js`).
- `sort_order` is a plain number field edited directly in the Add/Edit modal (unlike `news_ticker`'s ↑/↓ reorder buttons below) — announcements don't need drag-reordering since there are typically few of them at once.
- **`start_at`/`end_at` were `DATE` at first launch, changed to `TIMESTAMP` the same day (2026-07-28)** once the user confirmed minute-level scheduling was worth having. `TIMESTAMP` (no time zone), not `TIMESTAMPTZ` — treated as a naive Malaysia wall-clock value, same convention every other date-ish field in this repo already uses (see root `CLAUDE.md`'s Date handling pattern). `admin/news/pengumuman.html`'s modal uses `<input type="datetime-local">` (day+hour+minute, no seconds field — matches exactly what was asked for). `news/script.js` needed **zero changes** to support this: its `parseLocalDate()` already accepted a full timestamp string, only expanding a bare `YYYY-MM-DD` value to a full day — this was true before the column type ever changed. See `admin/CLAUDE.md`'s Key Patterns for the full writeup, including the live migration SQL for a database that already ran the old `DATE` version of `setup.sql` §10.

### `news_ticker`

One row per scrolling-ticker line. Read **directly** by Xibo's DataSet widget (`news/data/moving-text.json`) — no JS of ours runs there, so unlike `news_announcements`, `start_at`/`end_at`/`enabled` are resolved **server-side, at publish time** (`api/publish-news.js`'s `isActiveNow()`). An expired line only actually disappears from the live ticker once something republishes — which is why the daily cron (`vercel.json`, see `database.md` §1.9) exists at all.

```sql
id         UUID PK
message    TEXT NOT NULL
kind       TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'khutbah'))
prefix     TEXT               -- khutbah rows only, e.g. 'Khutbah Jumaat Minggu Ini: '
start_at   TIMESTAMP          -- day+hour+minute, changed from DATE 2026-07-28 — see note above
end_at     TIMESTAMP
enabled    BOOLEAN NOT NULL DEFAULT true
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- A `kind = 'khutbah'` row has no `message` — its published line is `prefix + <the resolved khutbah title>`, fetched from the same published CSV `khutbah/index.html` reads (`news_settings.khutbah_csv_url`). If that fetch fails for any reason, `api/publish-news.js` falls back to `news_settings.khutbah_last_title` (a cache it writes on every successful fetch); if that's empty too, the row is omitted entirely — it is never replaced with a placeholder or error text.
- `sort_order` is changed via `teks-berjalan.html`'s ⠿-grip drag-and-drop (re-pins 0..n-1, only changed rows written) or its ↑/↓ buttons (two plain `UPDATE`s swapping adjacent rows' `sort_order`), never a manually-typed number — still no drag-drop library (native HTML5 DnD), matching this repo's no-framework rule.
- **Same `TIMESTAMP` change as `news_announcements`, but with a real practical caveat this table doesn't share:** `isActiveNow()` compares down to the minute now (`mytDateTimeString()`/`normalizeBoundary()` in `admin/news/publish-news-pure.js`), but that comparison only ever runs **at publish time** — a ticker line scheduled to start at, say, 3pm won't actually appear on the physical screen until the next Terbitkan click or the next cron run (once/day on Vercel's Hobby plan). The schema/UI support minute precision either way; whether it's genuinely live on the ticker depends on cron frequency, a hosting-plan question — see `database.md` §1.9.

### `news_settings`

Key/value store so defaults and the khutbah CSV URL aren't hardcoded into `api/publish-news.js`.

```sql
key        TEXT PK
value      TEXT
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Seeded rows (see `setup.sql` §10): `default_image` (`/news/default.svg`), `default_ticker_line` (the ticker's empty-state fallback), `khutbah_csv_url` (the published CSV URL), `khutbah_last_title` and `khutbah_last_fetched_at` (the khutbah fail-safe cache, both start empty and are only ever written by `api/publish-news.js` itself — the admin UI never edits these two directly, though `teks-berjalan.html`'s khutbah row editor displays them read-only).

### `news_activity_log`

Same independent-auditability shape as `activity_log`/`infaq_activity_log`.

```sql
id           UUID PK
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
actor_email  TEXT NOT NULL
actor_name   TEXT
action       TEXT NOT NULL  -- news_announcement_create/update/delete |
                             -- news_ticker_create/update/delete/reorder |
                             -- news_settings_update |
                             -- publish_announcements | publish_moving_text
target_label TEXT
detail       TEXT
```

- Merged into `userlog.html`'s timeline from day one (unlike infaq's log, which had a gap until 2026-07-22) — `userlog.js`'s `LOG_SOURCES` array got a third entry alongside kuliah and infaq.
- `actor_email = 'vercel-cron'` for rows written by the daily cron's GET-triggered publish — distinguishable from a real admin's Terbitkan click in the log.

### Storage: `news-assets` bucket

Public bucket for announcement images, same 4-policy shape as `kuliah-assets` (public read, authenticated write/update/delete — not gated by `permissions.news` at the storage-policy level, matching `kuliah-assets`' own precedent). Upload path convention: `announcements/{safe-slug}-{timestamp}.{ext}` (see `pengumuman.js`'s `saveAnnouncement()`).

---

## 2.3 Staff tables

Added 2026-07-29 — a workforce identity/login layer, distinct from `admins`, for a future geolocation clock-in feature that isn't built yet. Independent of every other table above (no FK to `admins`, `ustaz`, or anything else).

```
staff (no FK to anything)      staff_activity_log (no FK, plain-text snapshots only)
```

### `staff`

One row per staff member. Two completely separate access paths read/write this table, and it's important to keep them straight — see `admin/CLAUDE.md`'s "Staff login never becomes a Supabase Auth principal" for the full reasoning:

1. **Admin roster management** (`admin/staff/roster.html`) — normal browser + anon key + the admin's own Supabase session, gated by RLS (`admin_can_write('staff')`, same shape as every other module).
2. **Staff login** (`staff/index.html`, served at `/staff` → `POST /api/staff-login`) — service-role key, bypasses RLS entirely. Staff never authenticate through Supabase Auth at all.

```sql
id                         UUID PK
full_name                  TEXT NOT NULL
phone                      TEXT
email                      TEXT               -- nullable; matched ONLY against a verified Google identity (ILIKE)
pin_hash                   TEXT                -- 'salt_hex:hash_hex' — PBKDF2-HMAC-SHA256, 100k iterations
device_session_token       TEXT                -- nullable; overwritten wholesale on every successful login
device_session_started_at  TIMESTAMPTZ
failed_pin_attempts        INTEGER NOT NULL DEFAULT 0
locked_until                TIMESTAMPTZ
enabled                     BOOLEAN NOT NULL DEFAULT true
created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- `pin_hash` is never set by hand — `admin/staff/roster.js`'s "Jana PIN Baharu" button generates it client-side (`generatePinAndHash()` in `admin/staff/staff-pin-pure.js`) and reveals the plaintext PIN exactly once for the admin to relay out-of-band. Nothing in this repo ever displays an existing PIN again after that reveal — only whether one is set at all.
- `device_session_token` is the entire "single active session" mechanism: every successful login (PIN or Google) overwrites it unconditionally. There's no separate sessions table — whichever token is currently stored is the only valid one. No expiry is enforced on it (`device_session_started_at` exists so a future feature could add one without a schema change).
- `failed_pin_attempts`/`locked_until` are written only by `api/staff-login.js` (on a PIN mismatch) and cleared either by a successful login (either method) or an admin's manual "Buka Kunci" action in `roster.html`. 5 failed attempts locks for 15 minutes (`LOCKOUT_THRESHOLD`/`LOCKOUT_MINUTES` in `staff-pin-pure.js`).
- `admin/staff/roster.js`'s own listing query deliberately excludes `pin_hash`/`device_session_token` from its `SELECT` — RLS doesn't stop an admin from fetching them (policies are row-level, not column-level), this is a convention, not a DB-enforced restriction. See `admin/CLAUDE.md`'s Key Patterns.
- **`service_role` gets `SELECT, UPDATE`, not the SELECT-only every prior publish endpoint gets** — `api/staff-login.js`'s entire job is writing lockout counters and the session token. This is the second table in this repo (after `news_settings`) to diverge from the SELECT-only convention; don't "fix" it back.

### `staff_activity_log`

Same independent-auditability shape as `activity_log`/`infaq_activity_log`/`news_activity_log`, but scoped narrower on purpose: **admin accountability only**, never a per-login-attempt security log. `api/staff-login.js` never writes here — the live `staff.failed_pin_attempts`/`locked_until` columns already give `roster.html` everything it needs to react to a lockout.

```sql
id           UUID PK
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
actor_email  TEXT NOT NULL   -- the ADMIN performing the roster action, never the staff member
actor_name   TEXT
action       TEXT NOT NULL   -- staff_create | staff_update | staff_delete |
                              -- staff_pin_reset | staff_lockout_cleared
target_label TEXT
detail       TEXT
```

- Merged into `userlog.html`'s timeline from day one, same as news — `userlog.js`'s `LOG_SOURCES` array got a fourth entry.
- PIN regeneration (`staff_pin_reset`) and lockout-clearing (`staff_lockout_cleared`) are logged as their own distinct actions rather than folded into a combined `staff_update` diff string — a security-relevant event is worth being independently filterable by the Tindakan dropdown. Don't fold a future security-relevant staff action into `staff_update` either; give it its own action value.
- **No `service_role` grant at all** — unlike every other `*_activity_log` table, nothing server-side ever writes here.

---

## 3. RLS & permissions (the part that's easy to get wrong)

**As of 2026-07-23 (`setup.sql` §9), write access is enforced per-role in Postgres — this replaced the fully-open state described below for most tables.** `admins`, `ustaz`, `schedule`, and all 4 infaq data tables (`infaq_projects`/`infaq_kutipan_mingguan`/`infaq_projek_kutipan`/`infaq_perbelanjaan_bulanan`) each moved from one permissive `FOR ALL` policy to 4 separate policies: SELECT stays open to any authenticated admin (unchanged), INSERT/UPDATE/DELETE are gated behind two new `SECURITY DEFINER` SQL helper functions:
- `admin_can_write(module_key)` — `true` for `role = 'super_admin'`, or `role = 'editor'` AND `permissions.<module_key>` is truthy. Used by `ustaz`/`schedule` (`'kuliah'`) and the 4 infaq tables (`'infaq'`).
- `admin_is_super_admin()` — `true` only for `role = 'super_admin'`. Used by `admins`' own policies — a non-super_admin can no longer write to the `admins` table at all via a raw API call (previously possible, and how a non-super_admin could have self-promoted, bypassing `users.html`'s own client-side gate entirely).

Both functions look up the caller's row via `WHERE email ILIKE auth.email()` (case-insensitive, same reasoning as the client-side/`api/publish.js` email matching elsewhere in this repo) and mirror `app.js`'s `canWriteModule(moduleKey)` exactly — that function is UI-level defense-in-depth (hides doomed write controls), **this SQL is the real enforcement**, since RLS applies even to a hand-written call from the browser console, not just the app's own code paths.

**Deliberately left unchanged: `activity_log`/`infaq_activity_log` still use one open `FOR ALL` policy**, no role check. `logActivity()` is fire-and-forget, called from many sites across every role, and always swallows its own errors so a logging failure never masks a real save/delete/publish failure to the user. A `viewer`'s real data writes are already blocked everywhere above, so a spoofed log row from a direct API call is inert noise — gating these too risked a misconfigured policy silently swallowing a legitimate editor's own audit entry instead, a worse failure mode than the marginal risk being closed.

There's still no true per-row restriction anywhere (e.g. one editor can't be limited to only their own changes) — that remains out of scope.

**The lesson learned the hard way, twice, building `activity_log`:** an RLS policy is *necessary but not sufficient*. Postgres checks table-level `GRANT` privileges **before** RLS is even evaluated — a role with no `GRANT` gets `permission denied for table X`, regardless of what policies exist. `ustaz`/`schedule`/`admins` happened to work without an explicit `GRANT` early on because they inherited access from that particular Supabase project's default privileges at the time they were created by hand — `activity_log` (created later, via this script) did not inherit anything, and neither will any table you create from a fresh project. **`setup.sql` now issues an explicit `GRANT` for every table, for every role that touches it, precisely so a from-scratch setup never depends on inherited defaults that may or may not exist.** This is a separate, still-true concern from the write-gating above — a `GRANT` is what lets a role touch a table _at all_; the new `INSERT`/`UPDATE`/`DELETE` policies then decide _whether that specific write is allowed_. Both still apply — `setup.sql` §9 doesn't touch any `GRANT`, only policies.

Two roles matter here, and they need separate grants:
- **`authenticated`** — every browser write (the anon key + a valid session) uses this role.
- **`service_role`** — used only by `api/publish.js`/`api/publish-infaq.js`, server-side, with the secret service-role key. This role bypasses RLS entirely (including the new §9 policies) but **still** needs its own `GRANT` — RLS-bypass and table-privilege-grant are two independent things in Postgres.

**Rule for any future new table:** add both a `CREATE POLICY` and explicit `GRANT`s to `authenticated` (and `service_role` too, if anything server-side will ever touch it) in the same `setup.sql` block. Don't assume either is inherited. If the table needs write-gating by role/module, reuse `admin_can_write(module_key)` (or `admin_is_super_admin()` for admin-only tables) rather than writing a new one-off check.

The infaq tables (§2.1) follow this exact same pattern — explicit `GRANT`s to `authenticated`, and `service_role` grants for the four tables `api/publish-infaq.js` reads (SELECT only, publish never writes them) plus full CRUD on `infaq_activity_log` (publish does write there).

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Ralat: permission denied for table X` (anywhere in the UI, `X` = any table) | Table has an RLS policy but no explicit `GRANT` for the role hitting it | Run `GRANT SELECT, INSERT, UPDATE, DELETE ON X TO authenticated;` (and `TO service_role;` too if the failing write comes from `api/publish.js`). See [§3](#3-rls--permissions-the-part-thats-easy-to-get-wrong). |
| `new row violates row-level security policy for table X` (X is `activity_log`/`infaq_activity_log`, or the acting admin IS an editor/super_admin with the right module permission) | RLS is enabled but there's no policy permitting the operation, or the request isn't actually authenticated (expired/missing session) | Confirm the policy from `setup.sql` §3/§7/§9 actually exists (`CREATE POLICY` may have silently failed on a re-run — see 1.2). If it exists, the session is likely expired — log out and back in. |
| `new row violates row-level security policy for table X` (X is `admins`/`ustaz`/`schedule`/any infaq data table, acting admin is a `viewer`, or an `editor` without that module's `permissions` flag) | **Expected as of 2026-07-23** — `admin_can_write()`/`admin_is_super_admin()` (§9) are correctly blocking a write this admin genuinely shouldn't be able to make. Not a bug — the UI should have already hidden the control that led here (see `canWriteModule()` in `app.js`); if a *permitted* editor/super_admin hits this, that's the real bug, see the row above instead. | Confirm the admin's actual `role`/`permissions` in the `admins` table match what's expected. If they should be able to write, fix their row in `users.html`, not the policy. |
| Redirected to `index.html?denied=1` right after Google login | Login succeeded but the email isn't in `admins` | Insert them: `INSERT INTO admins (email, name, role) VALUES ('their-email@gmail.com', 'Name', 'editor');` (or `'super_admin'`) |
| `relation "X" does not exist` | A section of `setup.sql` was never run (partial run, or ran an older copy of the file) | Re-run the missing section — safe to re-run `CREATE TABLE IF NOT EXISTS` blocks even if others already exist |
| `duplicate key value violates unique constraint "ustaz_short_name_key"` | Adding/renaming an ustaz to a `short_name` another row already has | `short_name` must be unique across all ustaz — pick a different one, or edit the existing row instead of creating a duplicate |
| Can't delete an ustaz — "masih ada dalam N sesi jadual" toast | UI guard: this ustaz is still assigned to at least one `schedule` row | Remove them from those days first (or use "Kosongkan Bulan" if it's a whole month), then delete. (If you ever bypass this via direct SQL, the FK's `ON DELETE SET NULL` prevents an error — affected schedule rows just revert to empty.) |
| Poster upload fails with a Storage error | `kuliah-assets` bucket or its policies (§4 of `setup.sql`) weren't created, or the file exceeds Supabase's default size/type limits | Confirm the bucket exists (Supabase Dashboard → Storage) and §4 ran cleanly; check Supabase project's Storage size limits if the file is large |
| Google OAuth redirects to an error page / "redirect_uri_mismatch" | The callback URL isn't registered in either Google Cloud Console or Supabase's URL Configuration | Re-check both sides of §5 in `setup.sql` — the exact callback URL Supabase shows must be in Google's Authorised redirect URIs, and your app's actual page URLs must be in Supabase's Redirect URLs list |
| `Terbitkan` fails instantly with a connection-error toast | Testing under plain `python -m http.server` — no `/api` route exists outside a real Vercel deployment | Expected locally. Test publish only on an actual Vercel deployment (preview or production). |
| `Terbitkan` fails: "Invalid or expired session" | The browser's Supabase session/JWT expired | Log out and back in, then retry |
| `Terbitkan` fails: "Server misconfiguration: missing Supabase/GitHub env vars" | One or more of `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GITHUB_TOKEN`/`GITHUB_REPO` isn't set in Vercel | Set them in Vercel Dashboard → Project → Settings → Environment Variables (see [1.5](#15-configure-vercel-environment-variables)), redeploy |
| `users.html`/`userlog.html` briefly flash then redirect to `dashboard.html` | Logged in as `role = 'editor'`, not `super_admin` — both pages are gated client-side | Expected behavior if you're not a super_admin. To promote someone: `UPDATE admins SET role = 'super_admin' WHERE email = '...';` |
| An admin's registered `name` shows up as their raw email address on rows written by `api/publish.js`/`api/publish-infaq.js` specifically (e.g. every "Terbitkan..." row in `userlog.html`, or the dashboard's "last published" note) — while rows logged from the browser (`logActivity()` calls) show the correct name fine | **Confirmed root cause (2026-07-22): `admins` was missing `GRANT SELECT ... TO service_role`** — both publish endpoints look up the actor's name from `admins` using the service-role key, and that lookup failed (permission denied) with **zero visible error**, silently falling back to the raw email. (A second, separate cause is still theoretically possible if it happens elsewhere: `admins.email` not case-matching what Google OAuth returns — Postgres `text` equality is case-sensitive by default. But this can't explain a *successfully logged-in* admin's own publish rows, since login itself already requires an exact `admins.email` match.) | Run `GRANT SELECT ON admins TO service_role;` (already added to `setup.sql` §3). If a *fresh* Supabase project still shows this, also check `admins.email` casing per the second cause. Existing already-logged rows don't retroactively fix themselves — only new ones after the grant is applied will show the name. |
| Nobody can access `users.html` to add the first admin | The bootstrap chicken-and-egg problem | Insert the first row manually via SQL — see [1.4](#14-bootstrap-the-first-super_admin) |
| Supabase SQL Editor shows "Potential issue detected — creates a table without enabling Row Level Security" while running part of `setup.sql` §8 | You selected/ran only a single `CREATE TABLE` statement in isolation — the matching `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` exist later in the same §8 section, so the linter (which only sees what you selected) can't see them | Cancel, then select and run the **entire** §8 section as one paste (see [1.7](#17-set-up-the-infaq-module-optional--separate-from-the-kuliah-setup-above)) — the warning doesn't apply once RLS-enable and the policy are part of the same run |
| Running `setup.sql` §8 errors on `CREATE POLICY "auth_all_infaq_projects" ... already exists` (or `auth_all_infaq_activity_log`) | Your database already ran an earlier version of §8 (the one that created `infaq_donations`/`infaq_expenses`, replaced 2026-07-21) — `infaq_projects`/`infaq_activity_log` are unchanged between versions, so their policies already exist | Don't re-run the whole section — see step 2 of [1.7](#17-set-up-the-infaq-module-optional--separate-from-the-kuliah-setup-above) for exactly which statements to run instead |
| `infaq_donations`/`infaq_expenses` still exist as tables but nothing in the app reads or writes them | Leftover from the pre-2026-07-21 schema, before the rebuild to match real Sheet data (see `DEV_NOTES.MD` session 11) | Harmless to leave (RLS-protected, just unused) — or run `setup.sql` §8b to drop them, after confirming in Table Editor they don't hold data you need |
| A project's `Terkumpul`/`Peratusan` in `projek.html` looks lower than expected, or lower than a figure quoted elsewhere (e.g. an older manually-maintained Sheet/site for the same project) | This system always **computes** the total by summing `infaq_projek_kutipan` rows — if an older system's own summary figure had drifted from its own underlying records (a real, confirmed issue found in the source Sheet during the 2026-07-21 import, see `DEV_NOTES.MD` session 11), the computed total here will legitimately differ, and the computed one is the trustworthy one | Don't "correct" this by inserting an adjustment row — investigate whether donation entries are genuinely missing from `infaq_projek_kutipan` (add them if so) or whether the other figure was simply wrong |
| A staff member says "PIN salah" repeatedly on `staff/index.html` (`/staff`), or `roster.html` shows a "Dikunci" badge | Either a genuinely wrong PIN 5+ times (locks for 15 minutes, `staff.locked_until`), or the admin generated a new PIN but never actually relayed the new one to the staff member (the old PIN stops working the instant a new one is saved) | Open the staff member in `roster.html` — if locked, click "Buka Kunci" to clear it immediately without waiting out the 15 minutes; either way, confirm the PIN they're using matches the last one actually generated (PINs are never re-displayed after their one-time reveal, so if unsure, just generate a new one) |
| Google login on `staff/index.html` (`/staff`) fails with "Log masuk Google tidak sah", or the Google button doesn't render at all | Either `staff/script.js`'s `GOOGLE_CLIENT_ID` constant was never filled in (button hides itself deliberately in this case — see `staff/CLAUDE.md`), it doesn't match the Vercel `GOOGLE_CLIENT_ID` env var `api/staff-login.js` checks against, or this page's origin isn't in the Google Cloud Console OAuth Client's Authorized JavaScript origins | Confirm all three match: the hardcoded browser-side value, the Vercel env var, and the origin allowlist (**Google Cloud Console → Credentials → the OAuth Client → Authorized JavaScript origins** — NOT Supabase's Redirect URLs, a likely mix-up since every other OAuth setup step in this repo refers to the Supabase one; this feature never uses `signInWithOAuth()` so that allowlist is irrelevant here) |
| A staff member logs in on their phone, works fine, then a colleague reports "I got logged out for no reason" | Expected — "single active session" means the newest login anywhere silently invalidates whichever session was active before, with no notification to the older device | Not a bug. If this UX is ever reported as confusing in practice, that's a product decision to revisit (see the plan this module was built from), not something to patch quietly |

---

## 5. Maintenance

- **Adding/removing/promoting admins:** normally through `users.html` once at least one super_admin exists. Direct SQL only needed for the very first bootstrap (1.4) or if every super_admin account is somehow locked out.
- **Adding a new table:** always add both an RLS policy *and* explicit `GRANT`s for every role that will touch it (`authenticated` for browser code, `service_role` too if any Vercel function will write to it) — see [§3](#3-rls--permissions-the-part-thats-easy-to-get-wrong). Don't assume default privileges will cover it.
- **Orphaned poster files:** replacing or removing an ustaz's poster does not delete the old file from the `kuliah-assets` bucket — it just stops being referenced. Currently unmanaged; if bucket size ever becomes a concern, an admin can manually clear unreferenced files from Supabase Dashboard → Storage, or this could be scripted later (compare bucket contents against `ustaz.poster_url` values).
- **`activity_log` growth:** unbounded by design (append-only, nothing in the app deletes rows). Trivial at this app's realistic scale — see the table's own notes in [§2](#activity_log). If it ever needs trimming, a manual `DELETE FROM activity_log WHERE created_at < ...` (or a proper retention policy) is the way, not a UI feature — deliberately not built into `userlog.html` (see `DEV_NOTES.MD` for why deleting log entries via the UI was considered and rejected).
- **Backups:** handled by Supabase's own project-level backups (see Supabase Dashboard → Database → Backups) — not something this repo manages.
- **Schema changes:** always update `setup.sql` to match live reality when you change something by hand in the SQL Editor — this file is the single source of truth for "how do I reproduce this database from nothing." A live schema that's drifted from `setup.sql` is exactly the gap that made the `admins` table missing in the first place.
- **Bulk-importing historical infaq data:** `admin/import-legacy-infaq-data.sql` is a one-time script for seeding `infaq_kutipan_mingguan`/`infaq_perbelanjaan_bulanan`/`infaq_projects`/`infaq_projek_kutipan` from a transcribed Sheet. Sections A/B are idempotent (`ON CONFLICT DO NOTHING` against their unique constraints); Section C (the project + its donations) is **not** — it has no unique constraint to conflict against (legitimate same-day duplicate donations are expected in real data), so re-running it creates duplicate rows. Read the file's own header before reusing this pattern for a different dataset.
- **infaq's `Jumlah Terkumpul`/rollups can legitimately disagree with an older, separately-maintained figure** (e.g. from a Sheet or a different site) — this system always computes from raw rows, so if an older system's own summary cell had drifted from its own underlying log (a real, confirmed case found 2026-07-21, see [§4 Troubleshooting](#4-troubleshooting)), don't "fix" the discrepancy by inserting an adjustment row here. Figure out which source is actually wrong first.
- **Disabling the news module's cron:** if `news/` is ever retired or Xibo is repointed elsewhere, remove the `crons` entry from `vercel.json` — an orphaned cron would keep publishing an unused `news/data/moving-text.json` daily forever otherwise. There's no "pause" flag; deleting the entry (or unsetting `CRON_SECRET`, which fails it closed) are the only two ways to stop it.
