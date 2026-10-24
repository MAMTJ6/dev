# CLAUDE.md — admin

Architecture reference for Claude Code when working in `admin/`.

**Moved here from `kuliah/admin/` on 2026-07-19** — see `admin/plan.md` for the
move itself (context, execution, verification). This file is the ongoing
architecture reference; the plan file is a one-time historical record.

## What this is

`admin/` is a full CMS admin dashboard for MAMTJ6 mosque management, hosting
six independent modules as of 2026-09-29:

- **`admin/kuliah/`** — lecture schedule management. Committee members log in
  with Google OAuth and manage: monthly lecture schedules (subuh + maghrib
  sessions per day), the ustaz (penceramah) list with poster images, quick
  access to the live published schedule ("Lihat Terbitan" dropdown), and bulk
  month actions ("Tindakan Bulan": duplicate the previous month forward, or
  clear a month entirely).
- **`admin/infaq/`** — donation/expense tracking, redesigned 2026-07-21 to
  match the mosque's real recording pattern (from the live `infaq.mamtj6.com`
  Sheet, not an assumed shape): general infaq is logged as one lump sum per
  week (`infaq_kutipan_mingguan`), expenses as one lump sum per month
  (`infaq_perbelanjaan_bulanan`) — both sparse, upserted, never
  hand-aggregated into a total. Only project-earmarked donations
  (`infaq_projek_kutipan`) are genuinely individual dated rows. Every
  further rollup (monthly/yearly totals, `graf`, active-project progress)
  is still always **computed**, never typed in directly (see
  `api/publish-infaq.js`).
- **`admin/news/`** — CMS for `news/`'s Xibo digital-signage displays, added
  2026-07-28. Two pages: `pengumuman.html` (announcement slides —
  `news/data/announcements.json`, read by our own `news/script.js`, which
  resolves the active schedule client-side on the display's own clock) and
  `teks-berjalan.html` (the scrolling ticker — `news/data/moving-text.json`,
  read DIRECTLY by Xibo's DataSet widget, so scheduling has to be resolved
  **server-side at publish time** instead — see `api/publish-news.js`).
  Retires the old Google Sheet → Apps Script → GitHub pipeline
  (`news/moving-text/code.gs`), which had no output validation at all and
  had been silently publishing a raw `"ERROR: ... Status: 503"` string to
  the live ticker for weeks before this was noticed (see `news/newplan.md`).
  A ticker line can optionally be `kind='khutbah'`, auto-sourced from the
  same published khutbah CSV `khutbah/index.html` already reads, with a
  fail-safe cache (`news_settings.khutbah_last_title`) so a bad fetch can
  never republish an error string again. A daily Vercel cron
  (`vercel.json`) republishes both files so an expired ticker line
  eventually disappears even with no admin action.
- **`admin/staff/`** — a staff **identity/login layer only**, added
  2026-07-29, for a future geolocation-based clock-in system that isn't
  built yet. One page, `roster.html` — admin-managed CRUD for a workforce
  (cleaners/guards/etc.) distinct from `admins`, following the exact same
  browser+RLS CRUD pattern as `ustaz.js`. **The one thing that makes this
  module structurally different from the other three:** its actual
  public-facing login surface (`staff/index.html`, served at `/staff` →
  `POST /api/staff-login`) deliberately never uses Supabase Auth at all — see
  "Staff login never becomes a Supabase Auth principal" in Key Patterns
  below before touching anything in this module, since getting that
  wrong is a real confidentiality hole, not a style preference.
- **`admin/khutbah/`** — Mimbar Jumaat weekly-sermon automation, added
  2026-09-15, retiring the Google Sheet → Apps Script → CSV pipeline
  (`khutbah/google_app_script/`). **Automation-first by explicit user choice:**
  a Mon-9am Vercel cron computes next Friday, builds the mufti.pahang.gov.my
  link (Gregorian slug + Hijri via `api.waktusolat.app/PHG03`), scrapes
  date/title, and publishes `khutbah/data/khutbah.json` read by
  `khutbah/index.html` (served at `/khutbah/`). Manual edits are secondary and lock their row
  (`manual_override=true` → cron skips with `skipped_locked`, no mail) — this
  explicit flag replaces the old Sheet formula/value distinction that silently
  broke automation. One page, `senarai.html` (weekly history + override editor
  + Tetapan card for `alert_emails`/`alert_from` + Jana & Terbitkan). Any
  scrape failure keeps last-good values (never publishes `ERROR:`) and emails
  all `alert_emails` via the shared sender (`admin/alert-send-pure.js`,
  Resend) — transition-only + 24h throttle. See `khutbah/upgrade-plan.md`.
- **`admin/calendar/`** — Takwim Islam date management, added 2026-09-29, retiring the standalone PIN page (`calendar/hijri/data/index.html`, now a redirect stub). One page, `senarai.html` (events table + Add/Edit modal + Peristiwa Terdekat preview + per-row countdown, mirroring the public `tarikh-penting/` card/buckets from in-memory edits) — publishes `calendar/hijri/data/events.json` (kept as single source of truth, no Supabase data table) via `POST /api/publish-events` (Bearer JWT, server-side `kalendar` perm check). Guards: Hijri spelling check (both Muharam/Ramadan and Muharram/Ramadhan accepted), <30-day staleness toast + publish confirm. Own `calendar_activity_log` (not yet in `userlog.html`). Dashboard has a Kalendar glimpse (next event + staleness).

Shared/cross-module concerns (login, nav shell, admin-user management,
activity-log viewer) stay flat at `admin/` root — see File Structure below.
It sits at the repo root, rather than under `kuliah/`, specifically *because*
it's a multi-module hub — `kuliah/admin/` would have been misleading once it
hosted non-kuliah modules. `kuliah/jadual/` is the public-facing read-only
schedule view that reads kuliah's published JSON — see `kuliah/CLAUDE.md` for
that side; `news/` is `admin/news/`'s equivalent public-facing side — see
`news/CLAUDE.md`. **infaq has no public-facing page yet** — its published
JSON lands in this repo (`admin/infaq/data/`) but nothing reads it publicly
yet, by deliberate choice (see `admin/infaq/`'s own history in
`admin/DEV_NOTES.MD`).

## Tech Stack

- Pure HTML5, CSS3, Vanilla JS (ES6+) — no npm, no build tools
- Neon — PostgreSQL for all tables (canonical schema `admin/neon-schema.sql`; `admin/setup.sql` kept as `setup.sql.legacy`). No RLS — per-module write access is enforced server-side in `api/*.js` via `lib/db.js` `requireAdmin(req, moduleKey)`; browser session is a cookie (`mamtj6_session`, Google OAuth via `/api/auth`), no Supabase client anywhere in `admin/` since 2026-10-15
- Supabase — Storage ONLY since 2026-10-24 (separate new project, buckets `posters`/`profiles`/`announcements`, public read): `api/upload.js` uploads there and returns an instant public https URL, stored as TEXT in Neon. Was GitHub-repo paths (`/kuliah/assets/...`, live only after Vercel redeploy) before — see `admin/DEV_NOTES.MD` session 24 for why that broke
- Vercel — static hosting + `api/*.js` serverless functions
- GitHub — published data store (JSON pushed via API from publish endpoint)

## File Structure

```
admin/
  index.html       ← Login page (Google OAuth) — shared, module-agnostic
  dashboard.html/.js ← Cross-module overview (added 2026-07-22) — the universal
                      post-login landing page for any admin with kuliah and/or
                      infaq access: today's/upcoming kuliah + month completion +
                      last-published status, and infaq's bulan-ini kutipan/
                      perbelanjaan + active project progress. Each section
                      links onward to jadual.html/ringkasan.html for full
                      detail. Replaces the old dashboard.html redirect stub
                      that used to live at this path.
  app.js           ← Shared: Supabase client, auth, toast, nav injection/hiding,
                      defaultLandingPageFor(), logActivity(action, label, detail, table)
  style.css        ← All admin styles (desktop + mobile ≤640px), incl. infaq stat cards/progress bar
  users.html/.js   ← Admin user management (super_admin only) — perm-kuliah + perm-infaq checkboxes
  userlog.html/.js ← Activity log viewer (super_admin only) — merges activity_log + infaq/news/khutbah logs via LOG_SOURCES; does NOT yet show calendar_activity_log rows (open, see DEV_NOTES session 22)
                      
  setup.sql        ← Supabase schema reference for ALL tables, both modules (do not run blindly)
  database.md      ← Full database docs: setup from scratch, schema, RLS/GRANT model, troubleshooting
  DEV_NOTES.MD     ← Session-to-session context memo (read before touching anything)
  developer.md     ← Developer setup and architecture guide
  plan.md          ← Historical record of the kuliah/admin/ → admin/ move (2026-07-19)

  kuliah/          ← Module: lecture schedule (moved here from admin/ root 2026-07-19)
    jadual.html/.js ← Monthly calendar + day editor modal, Terbitkan (renamed from dashboard.html/.js 2026-07-22)
    dashboard.html     ← zero-JS redirect stub → jadual.html (old path, kept working)
    ustaz.html/.js     ← Penceramah CRUD

  infaq/           ← Module: donation/expense tracking (new 2026-07-19, schema redesigned 2026-07-21)
    infaq-common.js    ← Shared across this module: requireInfaqAccess(), formatRM(), BULAN_MY,
                          publishInfaq()/loadLastPublishedInfaqNote(), publishInfaqProject()
                          (Terbitkan, shared by the 4 pages below)
    ringkasan.html/.js ← Module landing page: read-only stat cards + active-project progress only —
                          no Terbitkan here, each data page publishes itself (see below)
    kutipan.html/.js   ← General infaq: one row per week (tahun/bulan/minggu), upsert on save,
                          fetch-all-once + client-side year filter (small table, not paginated) —
                          owns the `monthly` Terbitkan button
    perbelanjaan.html/.js ← Expenses: one row per month (tahun/bulan), same upsert/fetch-all shape —
                          owns the `perbelanjaan` Terbitkan button
    projek.html/.js    ← Fundraising project settings CRUD (small list, like ustaz.js) — each row
                          links to projek-kutipan.html for that project's individual donations
    projek-kutipan.html/.js ← ONE project's individual dated donations (?project=<id> in the URL) —
                          paginated/filtered like the old kutipan.js, since this is the only infaq
                          table that's genuinely per-deposit — owns BOTH the `daily` Terbitkan button
                          (shown only when viewing the currently-active project, since daily.json
                          always reflects whichever one project is active, never a completed one)
                          AND the `project` Terbitkan button (shown for EVERY project — active or
                          completed — which writes THAT project alone to its own
                          <slug>_<uuid>.json file, see data/ line below)
    data/monthly.json, data/daily.json, data/perbelanjaan.json, data/data.json ← Fixed-name published data
                          admin/infaq/ writes (api/publish-infaq.js) — no reader yet. Under admin/
                          (not top-level infaq/, unlike kuliah's own data/ convention) since there's
                          no public consumer — colocated with the module that produces it. Field/key
                          shapes still deliberately mirror the real infaq.mamtj6.com reference
                          site's own structure, so a future public page or path migration stays cheap.
                          data.json is written by the `daily` Terbitkan action alongside daily.json
                          (2 files, 1 commit each, same request) rather than getting its own button —
                          see admin/developer.md's Publish endpoint section for why.
    data/<slugified-name>_<project-uuid>.json ← Per-project published data, ONE file per project,
                          written by the `project` Terbitkan action on projek-kutipan.html across
                          ALL projects (active or completed). Filename is
                          slugifyProjectName(NamaProjek) + '_' + the project's UUID so different
                          projects can't collide on the same name. Shape mirrors daily.json
                          ({ projek, paparanHarian, tarikhKemaskini }).

  news/            ← Module: Xibo signage CMS (new 2026-07-28) — unlike infaq's admin/infaq/data/
                      convention, this module's published JSON lives under top-level `news/data/`
                      (see admin/CLAUDE.md's Data Flow), matching kuliah's convention, because
                      news/ already has a public HTTP consumer (Xibo + news/script.js)
    news-common.js     ← Shared: requireNewsAccess(), publishNews()/loadLastPublishedNewsNote()
                          (Terbitkan, shared by both pages below), getSetting()/getSettings()/
                          saveSetting() (news_settings key/value table), computeStatus(row, now)
                          (Aktif/Akan Datang/Tamat/Dimatikan — used by both pages' tables),
                          NEWS_ACTION_ICONS (alias of global ACTION_ICONS + news-only duplicate
                          Edit/Duplicate/Padam buttons — one definition, title+aria-label kept)
    publish-news-pure.js ← THE SAME pure scheduling/CSV functions api/publish-news.js runs
                          (parseCSVRow, isActiveNow, buildAnnouncementsJson, buildMovingTextJson,
                          ...) — deliberately duplicated-by-reference (api/publish-news.js
                          `require()`s this exact file) rather than reimplemented, and kept OUTSIDE
                          api/ specifically so a plain <script src> can load it in the browser: any
                          file under api/ is itself a live Vercel serverless route, so a GET to
                          /api/publish-news.js would hit the real cron-auth handler, not serve
                          source. Loaded by teks-berjalan.html for the ticker preview panel — see
                          its own file header for the full reasoning
    pengumuman.html/.js ← Announcement slides CRUD — title/heading/text/image (upload to
                          news-assets bucket OR URL, mutually exclusive — reuses ustaz.js's 3-way
                          poster-save logic verbatim), start/end date, enabled, sort order. Owns
                          the `announcements` Terbitkan button. duplicateAnnouncement() prefills
                          the add-modal from an existing row (same timeframe, title + " (salinan)",
                          image reused via URL) so a second message never retypes the schedule.
                          Tetapan card edits `default_image`
    teks-berjalan.html/.js ← Ticker lines CRUD — ⠿-grip drag-and-drop reorders `sort_order`
                          (native HTML5 DnD, no library; ↑/↓ buttons kept as fallback). A `kind='khutbah'` row edits its `prefix` instead of free text
                          and shows the cached last-fetched khutbah title. duplicateTicker()
                          prefills the add-modal the same way pengumuman does. Owns the
                          `moving-text` Terbitkan button. Includes a "what will actually be
                          published" preview panel (see publish-news-pure.js above) — necessary
                          because, unlike pengumuman's client-filtered display, the ticker's
                          scheduling is resolved server-side, so an admin otherwise has no way
                          to see what Xibo will actually receive. Tetapan card edits
                          `default_ticker_line`

  staff/           ← Module: staff identity/login layer (new 2026-07-29) — login only,
                      no clock-in/attendance yet
    staff-pin-pure.js ← PBKDF2 PIN hash/verify/lockout logic — a plain static file (like
                          publish-news-pure.js), require()'d server-side by
                          api/staff-login.js AND loaded via <script> in roster.js, so
                          PIN generation (browser) and PIN verification (server) can
                          NEVER drift apart — same source file both places
    roster.html/.js   ← Staff CRUD (name/phone/email, PIN generation, lockout clear) —
                          mirrors admin/kuliah/ustaz.js's shape exactly

  alert-send-pure.js ← Shared email sender for ALL modules (new 2026-09-15, khutbah
                         is consumer #1) — sendAlert({to,subject,text}) + shouldAlert() +
                         parseRecipients(), Resend via fetch, no npm, never throws.
                         Same static-file-require()d-server-side convention as the
                         two pure files above; recipients live per-module in each
                         module's own *_settings table, never here
  khutbah/         ← Module: Mimbar Jumaat automation (new 2026-09-15)
    publish-khutbah-pure.js ← Ported .gs logic (Friday/SIRI/slugs/link/regex extract +
                         buildKhutbahJson) — same shared-pure-file convention
    khutbah-common.js ← Shared: requireKhutbahAccess(), publishKhutbah() (single
                         target, POST /api/publish-khutbah), get/saveKhutbahSetting(),
                         loadLastPublishedKhutbahNote()
    senarai.html/.js ← Weekly history table (Friday-desc) + override editor modal
                         (manual edit sets manual_override=lock) + Tetapan card
                         (alert_emails/alert_from) + Jana & Terbitkan button
   calendar/        ← Module: Takwim Islam dates (new 2026-09-29)
     calendar-common.js ← Shared: requireCalendarAccess(), publishCalendarEvents()
                          (POST /api/publish-events with session JWT + events array),
                          loadLastPublishedCalendarNote()
     senarai.html/.js ← Events table (Peristiwa Terdekat preview + per-row countdown,
                          Hijri spelling + <30-day staleness guards) + Add/Edit modal
                          + Simpan & Terbitkan button

admin/ustaz.html  ← zero-JS redirect stub → admin/kuliah/ustaz.html (old bare /admin/ URL,
                     pre-module-restructure, kept working). admin/dashboard.html used to be a
                     matching stub too, but that path now hosts the real cross-module overview
                     (2026-07-22) — see above.
kuliah/
  admin/           ← 5 zero-JS meta-refresh redirect stubs → /admin/... (URLs from BEFORE the
                      kuliah/admin/ → admin/ move, kept working)
  jadual/          ← Public schedule view (see kuliah/CLAUDE.md)
  paparan/         ← Digital signage (see kuliah/CLAUDE.md)
  data/jadual_lengkap_v2.json ← Published data admin/kuliah/ writes, that jadual/paparan read
staff/
  login.html/script.js/style.css ← Public staff login page (see staff/CLAUDE.md) —
                      the admin/staff/roster.html module above manages WHO can log in
                      here; this is the actual login surface staff use
```

## Supabase Schema

```sql
-- admins: who can log in
id uuid PK, email text UNIQUE, name text,
role text CHECK ('editor'|'super_admin'|'viewer'),  -- viewer added 2026-07-23, write access RLS-enforced (see database.md §3)
permissions jsonb,  -- { kuliah: bool }
created_at timestamptz

-- ustaz: penceramah registry
id uuid PK, full_name text NOT NULL, short_name text NOT NULL,
tajuk_kuliah text, poster_url text,
square_url text,  -- square-ratio poster variant, any resolution (added 2026-07-29,
                   -- no live consumer yet — see Key Patterns below)
jawatan text, profile_url text,  -- public-directory fields (added 2026-09-12 —
                   -- mugshot portrait, kuliah-assets/profiles/; read by kuliah/penceramah/)
is_public boolean DEFAULT true,  -- false rows dropped server-side by api/publish-ustaz.js
                   -- (added 2026-09-12; NULL counts as public)
created_at timestamptz, updated_at timestamptz

-- schedule: one row per date
id uuid PK, date date UNIQUE NOT NULL,
subuh_ustaz_id uuid FK→ustaz(id),
maghrib_ustaz_id uuid FK→ustaz(id),
subuh_pending boolean DEFAULT false,   -- "Belum Ditetapkan", mutually exclusive w/ subuh_ustaz_id
maghrib_pending boolean DEFAULT false,
subuh_khas boolean DEFAULT false,      -- "Kuliah Khas", independent of *_pending — added 2026-07-25
maghrib_khas boolean DEFAULT false,
subuh_ditangguhkan boolean DEFAULT false,   -- "Ditangguhkan", keeps ustaz like khas, MUST NOT combine w/ *_pending — added 2026-09-27
maghrib_ditangguhkan boolean DEFAULT false,
cuti_umum text, updated_at timestamptz

-- activity_log: accountability changelog for the kuliah module (see Key Patterns below)
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- schedule_day_edit | schedule_duplicate | schedule_clear |
                             -- ustaz_create | ustaz_update | ustaz_delete |
                             -- admin_create | admin_update | admin_delete | publish
target_label text, detail text  -- both plain-text snapshots, never FKs

-- infaq_projects: named fundraising campaigns, history kept (rows never
-- overwritten, only is_active flips). At most one active at a time
-- (partial unique index on is_active WHERE true).
id uuid PK, name text NOT NULL, target_amount numeric(12,2),
is_active boolean DEFAULT false, completed_at timestamptz,
launch_date date,  -- optional, added 2026-07-23 — see database.md
online_total numeric(12,2), online_total_updated_at date,  -- optional, added 2026-07-24 — bank-transfer
                             -- donation total, folded into every "Terkumpul" computation, see database.md
created_at timestamptz, updated_at timestamptz

-- infaq_kutipan_mingguan: general infaq, ONE ROW PER WEEK ACTUALLY COLLECTED
-- (matches the real Sheet — a lump sum per week, never per-donor). Sparse
-- by design: a week with nothing collected has no row. Upserted on
-- (tahun, bulan, minggu) — recording an existing week replaces its total.
id uuid PK, tahun integer NOT NULL, bulan integer CHECK (1-12) NOT NULL,
minggu integer CHECK (1-5) NOT NULL, jumlah numeric(12,2) CHECK (> 0) NOT NULL,
created_at timestamptz, updated_at timestamptz, UNIQUE(tahun, bulan, minggu)

-- infaq_projek_kutipan: individual dated donations earmarked to ONE
-- project — the only infaq table that's genuinely per-deposit. project_id
-- is required (general infaq never touches this table at all).
id uuid PK, project_id uuid FK→infaq_projects(id) NOT NULL,
tarikh date NOT NULL, jumlah numeric(12,2) CHECK (> 0) NOT NULL,
keterangan text, created_at timestamptz, updated_at timestamptz

-- infaq_perbelanjaan_bulanan: expenses, ONE ROW PER MONTH TOTAL — the real
-- Sheet never tracked category/description per expense, only a monthly
-- lump sum, so this matches exactly. Same sparse/upsert principle as
-- infaq_kutipan_mingguan.
id uuid PK, tahun integer NOT NULL, bulan integer CHECK (1-12) NOT NULL,
jumlah numeric(12,2) CHECK (> 0) NOT NULL,
created_at timestamptz, updated_at timestamptz, UNIQUE(tahun, bulan)

-- infaq_activity_log: SEPARATE from activity_log by deliberate choice
-- (independent auditability for money data) — otherwise identical shape
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- infaq_kutipan_mingguan_create/update/delete |
                             -- infaq_projek_kutipan_create/update/delete |
                             -- infaq_perbelanjaan_create/update/delete |
                             -- infaq_project_create/update/delete/activate |
                             -- publish_monthly | publish_daily | publish_perbelanjaan | publish_project
target_label text, detail text

-- news_announcements → news/data/announcements.json (see admin/news/ above)
-- start_at/end_at are TIMESTAMP, not DATE (changed 2026-07-28, same day as
-- the rest of this module) — day+hour+minute scheduling, no seconds field.
-- Naive/no-timezone, same "treat as Malaysia wall-clock" convention every
-- other date-ish field in this repo already uses.
id uuid PK, title text NOT NULL, heading text, body_text text,  -- body_text → published JSON "text"
image_url text, start_at timestamp, end_at timestamp,
enabled boolean DEFAULT true, sort_order integer DEFAULT 0,
created_at timestamptz, updated_at timestamptz,
CHECK (image_url IS NOT NULL OR body_text IS NOT NULL)  -- mirrors news/script.js's isActive():
                             -- an entry with neither can never display anything

-- news_ticker → news/data/moving-text.json. Unlike announcements, this
-- table's start_at/end_at/enabled are resolved SERVER-SIDE at publish time
-- (api/publish-news.js's isActiveNow()), not by the display — Xibo's
-- DataSet widget has no JS of ours to filter live. Same TIMESTAMP change as
-- news_announcements above.
id uuid PK, message text NOT NULL,
kind text DEFAULT 'static' CHECK (kind IN ('static','khutbah')),
prefix text,                -- khutbah rows only, e.g. 'Khutbah Jumaat Minggu Ini: '
start_at timestamp, end_at timestamp, enabled boolean DEFAULT true, sort_order integer DEFAULT 0,
created_at timestamptz, updated_at timestamptz

-- news_settings: key/value store, avoids hardcoding defaults/URLs into
-- api/publish-news.js. Seeded keys: default_image, default_ticker_line,
-- khutbah_csv_url, khutbah_last_title, khutbah_last_fetched_at (the last
-- two are the khutbah fail-safe cache — api/publish-news.js writes them
-- back on every successful CSV fetch, see Data Flow below)
key text PK, value text, updated_at timestamptz

-- news_activity_log: SEPARATE from activity_log/infaq_activity_log by the
-- same deliberate-independence reasoning — otherwise identical shape
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- news_announcement_create/update/delete |
                             -- news_ticker_create/update/delete/reorder |
                             -- news_settings_update |
                             -- publish_announcements | publish_moving_text
target_label text, detail text

-- staff: identity/login layer (added 2026-07-29) — a workforce distinct
-- from `admins`, no role/permission granularity. RLS (admin_can_write
-- ('staff')) governs ONLY the roster-CRUD path (admin/staff/roster.html);
-- staff logging in NEVER touches RLS at all — api/staff-login.js uses the
-- service-role key and bypasses it entirely. See "Staff login never
-- becomes a Supabase Auth principal" in Key Patterns below.
id uuid PK, full_name text NOT NULL, phone text,
email text,                 -- nullable; matched ONLY against a verified Google identity
pin_hash text,               -- 'salt_hex:hash_hex', PBKDF2-HMAC-SHA256, 100k iterations
device_session_token text,   -- nullable; overwritten wholesale on every successful login —
                              -- this IS the "single active session" mechanism
device_session_started_at timestamptz,
failed_pin_attempts integer NOT NULL DEFAULT 0,
locked_until timestamptz,
enabled boolean NOT NULL DEFAULT true,
created_at timestamptz, updated_at timestamptz

-- staff_activity_log: ADMIN-ACCOUNTABILITY ONLY (roster create/update/
-- delete/pin-reset/lockout-clear) — deliberately NOT a per-login-attempt
-- security log; that's a different concern than every other
-- *_activity_log table models. api/staff-login.js never writes here.
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- staff_create | staff_update | staff_delete |
                             -- staff_pin_reset | staff_lockout_cleared
target_label text, detail text

-- khutbah_weeks → khutbah/data/khutbah.json (added 2026-09-15) — one row per
-- Friday (friday_date UNIQUE, the conflict key). Automation-first: the cron
-- upserts the getNextFriday() row; manual_override=true locks it (cron
-- writes skipped_locked, leaves values untouched). scrape_status:
-- ok | fetch_failed | parse_failed | skipped_locked. main_text is
-- manual-only (the mufti page has no theme-text field).
id uuid PK, friday_date date UNIQUE NOT NULL,
source_url text NOT NULL, siri_text text NOT NULL,  -- MIMBAR JUMAAT SIRI {M} | {YYYY}
title text, date_text text, main_text text,
hijri_part text, gregorian_part text,  -- audit/debug slug segments
manual_override boolean DEFAULT false,
scrape_status text, scrape_error text, fetched_at timestamptz,
created_at timestamptz, updated_at timestamptz

-- khutbah_settings: key/value store (alert_emails comma-separated, "" = no
-- mail; alert_from must be @mamtj6.com — Resend can't send from free
-- providers; last_alert_at/last_alert_reason = spam-guard cache, written
-- back by api/publish-khutbah.js)
key text PK, value text, updated_at timestamptz

-- khutbah_activity_log: SEPARATE by the same deliberate-independence
-- reasoning as infaq/news — otherwise identical shape
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- khutbah_auto_generate | khutbah_scrape_ok |
                             -- khutbah_scrape_failed | khutbah_manual_update |
                             -- khutbah_lock | khutbah_unlock |
                             -- khutbah_settings_update | publish_khutbah
target_label text, detail text  -- target_label = friday_date, plain text, never a FK

-- calendar_activity_log (added 2026-09-29, setup.sql §13): SEPARATE by the
-- same deliberate-independence reasoning — otherwise identical shape.
-- No data table in this module: events.json on GitHub is the source of truth.
id uuid PK, created_at timestamptz,
actor_email text NOT NULL, actor_name text,
action text NOT NULL,       -- calendar_update | publish_calendar
target_label text, detail text
```

RLS is ON on all tables. `news_announcements`/`news_ticker`/`news_settings` follow the same 4-policy write-gated shape as every table added since §9 (`admin_can_write('news')`) — the one divergence from every other module's publish grants is `news_settings`, where `service_role` gets `SELECT, INSERT, UPDATE` (not SELECT-only), because `api/publish-news.js` writes the khutbah fail-safe cache back into it. `khutbah_weeks`/`khutbah_settings` (added 2026-09-15) repeat that same divergence deliberately — `api/publish-khutbah.js` upserts the week's row AND writes the alert spam-guard cache — don't narrow either to SELECT-only. See `admin/setup.sql` §10 and `database.md` §2.2 for the full detail. `staff` is a SECOND divergence from that same convention — `service_role` gets `SELECT, UPDATE` there too (`api/staff-login.js`'s entire job is writing lockout counters and the session token), while `staff_activity_log` gets no `service_role` grant at all (nothing server-side ever writes to it — see `admin/setup.sql` §11). Anon key used in browser (read/write with RLS). Service role key server-side only (Vercel env var). **New tables never inherit grants automatically** (see Key Patterns) — `infaq_projects`/`infaq_kutipan_mingguan`/`infaq_projek_kutipan`/`infaq_perbelanjaan_bulanan` grant `service_role` SELECT-only (publish reads, never writes them); `infaq_activity_log` grants `service_role` full CRUD (publish also writes to it), same as `activity_log`. `admins` also grants `service_role` SELECT-only (added 2026-07-22 — `api/publish.js`/`api/publish-infaq.js` both look up the publishing admin's name from it; this table predates that lookup, so the grant was missing for a long time and failed silently rather than erroring, see Key Patterns).

## Data Flow

```
kuliah: Admin edits day in admin/kuliah/jadual.html
  → upsert to Supabase `schedule` (date is the conflict key)
  → click Terbitkan (publish)
  → POST /api/publish?month=YYYY-MM  (Bearer: session token)
  → api/publish.js validates token, reads schedule+ustaz from Supabase (service role)
  → builds jadual_lengkap_v2.json
  → pushes to GitHub via API (GITHUB_TOKEN env var)
  → Vercel serves updated JSON

penceramah: Admin edits a row in admin/kuliah/ustaz.html (added 2026-09-12 —
  jawatan/profile_url/is_public alongside the existing poster fields)
  → insert/update directly on Supabase `ustaz`
  → click Terbitkan Penceramah
  → POST /api/publish-ustaz (Bearer: session token, no params — whole registry)
  → api/publish-ustaz.js reads ustaz (service role), drops is_public = false
    rows (NULL counts as public), sorts short_name numeric-aware in JS
  → pushes kuliah/data/penceramah.json (skips the commit if byte-identical)
  → read by kuliah/penceramah/ (list + ?embed=1 + profile popup, which ALSO
    reads jadual_lengkap_v2.json itself for this-month sessions — the popup's
    schedule lookup is client-side, not part of this publish)

infaq: Admin logs a week's total in admin/infaq/kutipan.html, a month's
  total in perbelanjaan.html, or an individual project donation in
  projek-kutipan.html
  → upsert to Supabase `infaq_kutipan_mingguan` (tahun,bulan,minggu) /
    `infaq_perbelanjaan_bulanan` (tahun,bulan), or insert to
    `infaq_projek_kutipan` (genuinely one row per deposit) — none of these
    are ever hand-aggregated into a further total
  → click Terbitkan on that same page (kutipan.html / perbelanjaan.html /
    projek-kutipan.html each own their own button, right next to the data
    they publish — no Terbitkan on ringkasan.html, which is read-only)
  → POST /api/publish-infaq?target=monthly|daily|perbelanjaan|project
    (project requires an extra &project=<uuid>; Bearer session token, no month
    param — always a full as-of-now snapshot of that ONE file)
  → api/publish-infaq.js reads only the Supabase table(s) that target needs
    (service role), COMPUTES weekly/monthly/yearly rollups + active-project
    progress for that file only
  → pushes exactly ONE of admin/infaq/data/{monthly,daily,perbelanjaan}.json
    to GitHub, OR for target=project the per-project file
    admin/infaq/data/<slugified-name>_<project-uuid>.json
  → no public reader yet — see What This Is

news: Admin edits a row in admin/news/pengumuman.html or teks-berjalan.html
  → insert/update/delete directly on Supabase `news_announcements` /
    `news_ticker` (ticker reorder is 2 plain sort_order updates, no RPC)
  → click Terbitkan on that same page (each owns its own button + target)
  → POST /api/publish-news?target=announcements|moving-text (Bearer: session
    token) — OR the daily Vercel cron hits the same endpoint with
    GET + Authorization: Bearer <CRON_SECRET>, publishing BOTH targets
  → api/publish-news.js reads news_announcements (announcements target) or
    news_ticker (moving-text target) + news_settings (service role)
  → announcements: buildAnnouncementsJson() keeps future/expired rows as-is
    (news/script.js filters the active window live, on the display's clock)
  → moving-text: buildMovingTextJson() FILTERS by isActiveNow() here (Xibo's
    DataSet widget has no JS of ours to filter live) — a kind='khutbah' row
    resolves via a CSV fetch of news_settings.khutbah_csv_url (the same feed
    khutbah/index.html reads), falling back to the cached
    khutbah_last_title on ANY failure (never publishes an error string),
    omitting the row entirely if there's truly nothing usable; an empty
    result falls back to one default_ticker_line row
  → pushes news/data/announcements.json or news/data/moving-text.json to
    GitHub, SKIPPING the commit if the content is byte-identical to what's
    already there (so the daily cron doesn't manufacture empty commits)
  → served from news/data/ (public, no-store cache header — vercel.json),
    read by news/script.js (announcements) or configured directly into
    Xibo's DataSet widget (moving-text)

staff: Admin manages the roster in admin/staff/roster.html
  → insert/update/delete directly on Supabase `staff` (admin_can_write
    ('staff') RLS — same browser+RLS pattern as ustaz.js, NOT the
    publish/service-role pattern above)
  → no Terbitkan/publish step — nothing here writes a file to GitHub, this
    module has no public JSON output at all

khutbah (automation-first, manual secondary — explicit user choice 2026-09-15):
  Vercel cron Mon 9am MYT GET /api/publish-khutbah (Bearer CRON_SECRET)
  OR admin clicks Jana & Terbitkan POST /api/publish-khutbah (Bearer session)
  → compute getNextFriday (today if Friday) → Hijri via api.waktusolat.app/PHG03
  → build mufti link + SIRI text
  → locked? (manual_override) → skip scrape AND alert, publish current JSON as-is
  → fetch mufti URL (!ok incl. 404 → fetch_failed) → extractDateTitle
    (miss → parse_failed) — EITHER failure keeps last-good values (never
    publishes ERROR:) and emails khutbah_settings.alert_emails via the shared
    sender (transition-only + 24h throttle), logging alert_sent/suppressed
  → upsert khutbah_weeks (friday_date conflict key) → rebuild
    khutbah/data/khutbah.json ({current, history}) → push to GitHub
    (skip if byte-identical) → khutbah_activity_log row
  → read by khutbah/index.html (60s poll)
  Separately, admin edits a row in senarai.html → manual_override lock +
  khutbah_manual_update/khutbah_lock log rows (browser+RLS, no publish involved)

  Separately, staff themselves log in at staff/index.html (served at
  /staff, NOT part of the flow above, and NOT triggered from admin/ at all):
  → staff picks their name (GET /api/staff-login, public roster listing)
  → PIN: POST /api/staff-login {method:'pin', staff_id, pin} — OR —
    Google: POST /api/staff-login {method:'google', id_token} (verified
    against Google's own tokeninfo endpoint, NOT Supabase Auth)
  → api/staff-login.js (service role, bypasses RLS entirely) verifies
    the credential, rate-limits/locks out on PIN failure, and on success
    overwrites staff.device_session_token — the "single active session"
    mechanism, see Key Patterns below
  → returns a token staff/script.js stores in localStorage — nothing
    currently reads it back; a future clock-in feature would
```

## Key Patterns

**Sidebar nav — static HTML/CSS shell + one `MODULES` config in `app.js` for the links (redesigned 2026-07-22, then again same day to drop Tailwind CDN):** the old flat top nav was hand-copy-pasted into all 9 admin pages and had already drifted (kuliah pages collapsed infaq into one link, infaq pages listed kuliah's links individually alongside all 4 of infaq's own — the exact clutter that prompted this redesign). A first pass built the whole sidebar via JS + Tailwind Play CDN, but on this multi-page app (every click is a full page reload, not client-side routing) the CDN's runtime JIT scan/style-generation on every single navigation was visibly slow and caused a flicker even after the JS-timing issue below was fixed — so the sidebar shell went back to plain static HTML/CSS (same mechanism as everything else on this site), and Tailwind CDN was dropped from `admin/` entirely. Every page now has the *same, identical, permission-agnostic* sidebar shell markup (topbar/backdrop/`<aside id="sidebar">` frame with an empty `<nav id="sidebar-nav">` placeholder) directly in its HTML — copied, but with zero drift risk since it never varies per page — plus its existing `<div class="page">` wrapped in `<div class="admin-content">` so content clears the fixed sidebar on desktop:
```html
<head>
  ...
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
</head>
<body>
  <div class="sidebar-mobile-topbar">
    <button class="sidebar-toggle-btn" onclick="toggleNav()" aria-label="Menu">&#9776;</button>
    <span>Admin MAMTJ6</span>
  </div>
  <div class="sidebar-backdrop" id="sidebar-backdrop" onclick="closeNav()"></div>
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand">Admin MAMTJ6</div>
    <nav class="sidebar-nav" id="sidebar-nav"></nav>
    <div class="sidebar-footer">
      <button class="sidebar-logout-btn" onclick="signOut()">Log Keluar</button>
    </div>
  </aside>
  <div class="admin-content">
    <div class="page"> ... </div>
  </div>
  <!-- modals stay outside the wrapper, unaffected -->
  <script src="/admin/app.js"></script>
  ...
</body>
```
All sidebar styling (colors, fixed positioning, the off-canvas mobile transform) lives in `admin/style.css`'s "Sidebar" section as plain hand-written CSS — it paints in the browser's normal blocking `<link>` pass, with zero JS/CDN dependency, exactly like every other page element. Only `#sidebar-nav`'s *contents* — the actual module links, which genuinely depend on the logged-in admin's permissions — are JS-rendered: `renderSidebar()` (called once from `requireAuth()`) builds them from a single `MODULES` array in `app.js`. Every href lives once in `MODULES`, always absolute (`/admin/...`), which structurally rules out the relative-path-under-cleanUrls landmine (below) for every nav link permanently. Each `MODULES` item carries a `match` array of every pathname that should highlight it active — this is how `projek-kutipan.html` (an infaq sub-page, not one of the 4 visible labels) highlights "Projek" as its active parent without any filename-guessing. **If you add a module or a page, add one entry to `MODULES` — that's the whole change now, not "update both `_injectSuperAdminNav()` and `_hideUnauthorizedModuleLinks()` and every page's hardcoded `class="active"`" like before.**

**A different `cleanUrls` surprise: Vercel REDIRECTS a `.html`-suffixed URL to its extensionless form, which broke sidebar active-highlighting until fixed 2026-07-22 (found from a live screenshot — the sidebar showed no active item on any page):** every `MODULES` `href`/`match` entry is written with a literal `.html` suffix (matching this repo's own convention everywhere else — `defaultLandingPageFor()`, redirect stubs, `signInWithGoogle()`'s `redirectTo`, all `.html`-suffixed). But `vercel.json` has `cleanUrls: true`, which doesn't just serve a directory's `index.html` at the bare path (the landmine below) — it also issues a real 308 redirect from `/admin/kuliah/jadual.html` to the extensionless `/admin/kuliah/jadual` for **any** `.html` file, not just `index.html`. So on the live deploy, `window.location.pathname` never actually has a `.html` suffix by the time `renderSidebar()` runs — it silently never matched any `MODULES` `match` entry, on every page, not just one. **Invisible locally by construction**, same as the landmine below — `python -m http.server` doesn't perform Vercel's redirect at all, so a local test sees the literal `.html`-suffixed path and the bug never reproduces there. Fixed by normalizing both `window.location.pathname` and every `match` entry (strip a trailing `.html` from each) before comparing in `renderSidebar()`, rather than changing every href to the extensionless form (which would also need re-registering the OAuth redirect URL in Supabase's allowlist for `signInWithGoogle()`'s `redirectTo` — a much bigger, riskier change than a highlighting bug warrants). **If sidebar highlighting ever breaks again, check this normalization is still in `renderSidebar()` before assuming the `MODULES` data itself is wrong.**

**Any HTML `href`/`src`, and any JS-driven navigation (`window.location.replace`/`.href`), under `admin/` must use absolute root-relative paths (`/admin/...` or `/admin/kuliah/...`/`/admin/infaq/...`), never a bare/relative filename — this is a repo-wide landmine, hit multiple times in different folders (see `kuliah/CLAUDE.md` for the `kuliah/paparan/` recurrence):** Vercel's `cleanUrls: true` serves a directory's `index.html` at the bare directory path with **no trailing slash** (`/admin`, `/admin/kuliah`). Per standard URL relative-resolution rules, any relative reference from a slash-less path treats the last path segment as a filename to be *replaced*, not a directory to append to. Session 7 (back when this lived at `kuliah/admin/`): `index.html`'s relative `window.location.replace('dashboard.html')` resolved one level too high — fixed with absolute paths. Those absolute paths were re-swept to `/admin/...` on the 2026-07-19 root move (`admin/plan.md`), then re-swept AGAIN the same day to `/admin/kuliah/...` for the module restructure (dashboard.html/ustaz.js moved a level deeper) — **this is now a recurring cost of any future path change, not a one-time fix; grep for the old path every time you move something.** `admin/infaq/`'s landing page is deliberately named `ringkasan.html`, not `index.html`, specifically to avoid a THIRD instance of this bug (an `index.html` under `admin/infaq/` would itself be served at the bare slash-less `/admin/infaq` path). **Treat this as a mandatory check for any brand-new HTML entry point added under `admin/` — a relative asset path will work perfectly under local `python -m http.server` and under Live Server, and only break once deployed to Vercel, so local testing alone will not catch it.** (Nav links specifically are no longer at risk from this — the 2026-07-22 sidebar redesign centralized every nav href into `app.js`'s `MODULES` array, always written absolute, so there's no more per-page copy to regress. This still applies to everything else: redirects, form actions, fetch URLs, new pages. Proven out the same day: the `dashboard.html` → `jadual.html` rename only needed 3 one-line edits in `app.js` — `MODULES`, `defaultLandingPageFor()`, and the OAuth `redirectTo` — instead of a repo-wide grep-and-fix.)

**Module permission gate (`permissions.kuliah`/`permissions.infaq` on `admins`, added 2026-07-19):** every module page calls a gate right after `requireAuth()` — `admin/infaq/*.js` pages call `requireInfaqAccess()` (`admin/infaq/infaq-common.js`), `admin/kuliah/jadual.js`/`ustaz.js` call `requireModuleAccess('kuliah')` directly. Both are backed by the same generic `requireModuleAccess(moduleKey)` in `app.js` (`requireInfaqAccess()` is now a 1-line wrapper around it) — denies and redirects unless `role === 'super_admin'` or `permissions.<moduleKey>` is truthy. **`admin/kuliah/` had no equivalent gate until 2026-07-23** (`permissions.kuliah` existed in the schema and was editable in `users.html`, but nothing checked it — see `admin/DEV_NOTES.MD` for that history); closed alongside adding the `viewer` role, since "which modules can an admin access" was meaningless for kuliah without it. `defaultLandingPageFor(admin)` (app.js) is the shared "where does this admin land" helper — any admin with `role === 'super_admin'` or either `permissions.kuliah`/`permissions.infaq` lands on the shared `/admin/dashboard.html` overview (which itself shows/hides each module's section based on that same permission check, and links onward to `jadual.html`/`ringkasan.html`), else `null` (caller must show a message, **never** redirect on `null` — redirecting to another gated page is exactly how you get a bounce loop between two denied pages). This also closes a gap the old per-module landing had: `signInWithGoogle()`'s OAuth `redirectTo` is a single fixed URL (Supabase/Google only allow redirecting to an allowlisted URL, not a dynamically-computed one) — it used to always be `jadual.html` regardless of the admin's actual permissions, so an infaq-only admin's first-ever login landed them on a kuliah page. Now it's `dashboard.html`, which is meaningful for any permitted admin.

**Read vs. write are two separate checks (`viewer` role, added 2026-07-23):** `requireModuleAccess(moduleKey)` (above) only decides whether an admin can *see* a module page at all — it treats `'editor'` and `'viewer'` identically, both gated purely on `permissions.<moduleKey>`. A second function, `canWriteModule(moduleKey)` in `app.js`, decides whether they can actually write there: `role === 'super_admin'`, or `role === 'editor'` AND `permissions.<moduleKey>` truthy — `'viewer'` always returns `false`, unconditionally. Every Add/Edit/Delete/Terbitkan control across `admin/kuliah/` and `admin/infaq/` is wrapped in a `canWriteModule()` check (hidden button, or in `jadual.js`'s day-editor modal — the one write control that isn't a simple button — disabled fields with Save hidden, since the modal itself stays open so a viewer can still inspect a day's detail). **This UI-level check is a courtesy, not the real security boundary** — the actual enforcement is in Postgres: `admin/setup.sql` §9's `admin_can_write(module_key)`/`admin_is_super_admin()` `SECURITY DEFINER` SQL functions back real per-table RLS policies (SELECT open, INSERT/UPDATE/DELETE gated) on `admins`, `ustaz`, `schedule`, and all 4 infaq data tables — mirrors `canWriteModule()`'s logic exactly, so a viewer (or a direct API call bypassing the UI entirely) genuinely cannot write, not just can't see the button. `activity_log`/`infaq_activity_log` were deliberately left ungated — see `database.md` §3 for the reasoning. Full design/reasoning: `database.md` §3.

**Mobile breakpoints:**
- `≤768px` — tablet compact; also where the sidebar goes off-canvas (`admin/style.css`'s `@media (max-width: 768px)` sidebar rules — `.sidebar` gets `transform: translateX(-100%)` by default, `.sidebar.open` reverses it, toggled by `toggleNav()`/`closeNav()` in `app.js`; a `.sidebar-mobile-topbar` provides the hamburger below this width, hidden above it. Deliberately the same breakpoint as the pre-existing tablet-compact zone rather than a second one.)
- `≤640px` — phone: card-per-row tables, day list calendar

**Data table mobile pattern:** Every JS-rendered `<td>` needs `data-label="..."` for the card-per-row mobile layout. CSS reads `content: attr(data-label)` via `::before`.

**Ustaz sort:** Always client-side with `localeCompare({ numeric: true })`. Never `.order('short_name')` on Supabase — it sorts lexicographically. Both `ustaz.js` (Penceramah page `#` column) and `jadual.js` (day-editor Subuh/Maghrib dropdowns) sort this exact way so their numbering lines up — `jadual.js`'s `openModal()` renders each option as `"{short_name} (N)"` (suffix, not prefix, so the browser's native type-to-jump-by-letter still works), 0-indexed, with `"— Tiada Kuliah —"` pinned first and unnumbered. These numbers are a recalculated position, not a stored field — they shift if the ustaz roster changes.

**`isYasinEntry(ustaz)` (app.js):** matches `/yasi+n/i` against `short_name + full_name` combined, to detect the "Bacaan Yasiin & Tahlil" special ustaz entry regardless of which field has which spelling ("Yasin" vs "Yasiin"). `jadual.js` uses it to swap the calendar's session-tag pill / mobile day-list text to a `.yasin`/`.mdc-yasin` light-green style instead of the normal subuh/maghrib colors. Use this helper (not a hardcoded dropdown position — those aren't stable) if this needs extending anywhere else.

**Poster save (3-way logic in saveUstaz):**
- `pendingRemovePoster` → `poster_url: null`
- New file or URL entered → `poster_url: newValue`
- Neither → omit `poster_url` from payload (preserves existing)
- Server-side (`api/kuliah.js` `ustaz-save`, fixed 2026-10-24): an omitted key keeps the existing DB value (SELECTs the prev row, coalesces); only an explicit `null` clears. Before this fix the UPDATE wrote `poster_url = ${r.poster_url || null}`, so any edit without a new upload silently wiped the stored URL — the "neither → omit" contract above was a lie until the server honored it. Same rule must hold for `square_url`/`profile_url`.

**Square poster (`ustaz.square_url`, added 2026-07-29) — a second, independent field, same 3-way save logic duplicated verbatim, not shared:** built ahead of any actual consumer, for a future square-ratio use case (`kuliah/paparan/` or similar signage variant hasn't been designed yet). `ustaz.html`'s modal has its own upload/URL/current-image/remove group below the existing poster fields; `ustaz.js` tracks it with a fully separate `pendingRemoveSquarePoster` flag and `newSquareUrl` variable — deliberately not refactored into one shared upload helper with `poster_url`'s block, since the two fields' upload paths differ (`posters/` vs `posters-square/`, same `kuliah-assets` bucket — the bucket's RLS gates on `bucket_id` only, no path-prefix policy, so no new Storage policy was needed) and keeping them fully parallel keeps a future "square poster only" or "landscape poster only" behavior change from accidentally touching both. `api/publish.js` forwards `square_url` into the published JSON's `subuh`/`maghrib` ustaz objects exactly where `poster_url` already is (same `|| null` fallback) — unused by any current page, but avoids a second `api/publish.js` change whenever a consumer is finally built. **If you build the square poster's actual display use case, decide then whether the duplicated save logic is worth collapsing into a shared helper — don't preemptively refactor now.**

**Cache-busting:** `vercel.json` serves `Cache-Control: no-store` for `/admin/(.*)` and `/kuliah/jadual/(.*)`. `no-store` (not `max-age=0, must-revalidate`) is required — `must-revalidate` still lets mobile Chrome serve the page from bfcache with zero network request, so a stale copy with old JS can resurface after backgrounding the app. `no-store` disables bfcache for these routes.

**Dropdown menu pattern:** `.month-actions` (wrapper, `position: relative`) + `.month-actions-menu` (absolute-positioned panel, `.open` class toggles `display`) + `.month-actions-item` (row). Closed via a single shared `document.addEventListener('click', ...)` in `jadual.js`; each trigger button calls `e.stopPropagation()` so its own click doesn't immediately close it again. Both the "Tindakan Bulan" (Salin Data / Kosongkan) and "Lihat Terbitan" (Tunjukkan Jadual / Export PDF) dropdowns in `jadual.html` reuse this exact CSS — reuse it for any future dropdown rather than inventing a new one.

**Publish merges by absolute month key, prunes stale months:** `jadual_lengkap_v2.json` is `{ "months": { "YYYY-MM": { infoJadual, senaraiHari }, ... } }`. Each `Terbitkan` click (`api/publish.js`) reads the existing file, writes only `months[thatMonth]`, and leaves every other key untouched — so publishing "next month" (even to clear it) no longer wipes out "this month"'s data. The endpoint rejects any `month` that isn't the real-current or real-next `YYYY-MM` (computed server-side in Malaysia time, UTC+8) and prunes any other key out of `months` on every publish, so the file never holds more than these two months at once. `kuliah/jadual/script.js` looks up `jsonData.months[monthKey]` where `monthKey` is derived from `baseDate` (today, or +1 month for `?bulan=depan`) — so month rollover (July → August) is automatically correct with no republish needed, since the key was already written when that month was "next month". If a month key is entirely absent (never published), the public page shows "Jadual belum diterbitkan buat masa ini." instead of a blank-looking page.

**Local testing:** `Terbitkan` calls `POST /api/publish`, a Vercel serverless function that does not exist under plain `python -m http.server` (the documented local-dev method for this repo) — it will 404 and surface as a "Ralat sambungan" toast. Day-edit/save, and the Duplicate/Clear month actions (below), all write directly to Supabase instead — same production project everywhere, no local/prod split — so they work locally but have real, immediate, non-sandboxed effects on production data.

**Month action buttons only show for the real current/next month:** `jadual.js`'s `updateScheduleActions()` computes `isRealCurrent`/`isRealNext` from an actual `new Date()` (never from the dashboard's own navigable `currentYear`/`currentMonth`), since `kuliah/jadual/script.js` can only render the real current month or real next month (`?bulan=depan`) — no arbitrary-month param exists. This one computation also drives the "Bulan Ini"/"Bulan Depan" `#month-tag` badge and whether `#future-month-note` (vs the Terbitkan button) is shown.

**Duplicate/Clear month actions:** "Salin Data {previous month}" copies `subuh_ustaz_id`/`maghrib_ustaz_id` only (never `cuti_umum` — holidays are date-specific and copying them forward would mislabel the wrong day) from the month immediately before whatever's currently displayed, matched by day-of-month number, full overwrite (confirmation modal shows how many already-filled target days will be replaced). "Kosongkan Bulan Ini" hard-deletes all `schedule` rows in the viewed month's date range. Both require the confirmation modal — same safeguard regardless of which month is targeted, including the real current/live month.

**"Last published" note on the dashboard (`#last-published-note` in `jadual.html`, `loadLastPublishedNote()` in `jadual.js`):** shown under the toolbar hint, only for the real current/next month (rides the same `isRealCurrent`/`isRealNext` gate `updateScheduleActions()` already computes). Reads the most recent `activity_log` row where `action = 'publish'` and `target_label` exactly matches the viewed month's label (e.g. `"Julai 2026"`) — no new logging needed, `api/publish.js` already writes this row on every successful Terbitkan. Shows `"Bulan ini belum pernah diterbitkan."` if no row exists yet. Refreshed on month navigation and immediately after a successful publish (no reload needed). Formatting helpers `formatDateTimeMY()`/`formatRelativeMY()` (Malay relative-time ladder: baru sahaja → minit → jam → hari → minggu → bulan lalu) live in shared `app.js`.

**Email matching against `admins.email` must use `ilike`, not `eq`:** Postgres `text` equality is case-sensitive by default, and `admins.email` (often typed by hand, e.g. via `setup.sql`'s bootstrap insert) isn't guaranteed to match the exact casing Google OAuth/Supabase Auth actually returns for that account. A mismatch doesn't error — `.eq('email', ...)` just silently matches zero rows, and whatever fallback exists kicks in quietly. Both `jadual.js`'s last-published-note admin-name fallback lookup and `api/publish.js`'s own actor-name lookup use `.ilike()` (`email=ilike.` in the REST form) for this reason — use the same for any future email-matching query against `admins`.

**"Belum Ditetapkan" pending slots (session 8):** a Subuh/Maghrib slot can be marked pending instead of assigned an ustaz — for a day known to have a lecture happening where the speaker/topic isn't decided yet. Day-editor modal (`jadual.html`) has a checkbox per session (`subuh-pending-check`/`maghrib-pending-check`) under each ustaz `<select>`; checking it disables+clears that select (`toggleSubuhPending()`/`toggleMaghribPending()` in `jadual.js`). `saveDay()` writes `schedule.subuh_pending`/`maghrib_pending` (booleans, mutually exclusive with the matching `*_ustaz_id` — checking pending forces the id to `null`). `api/publish.js` maps a pending slot to a `{ pending: true }` marker object in the published JSON instead of an ustaz object or `null` — this is truthy, so it automatically routes correctly through every existing "is this day/session empty" check with zero changes to that logic. `kuliah/jadual/script.js` renders it as a dashed-border block with a generic "Akan Diumumkan" sub-label (was unconditionally "Ceramah Khas — Akan Diumumkan" until 2026-07-25 — **not Khas-specific**, see the Kuliah Khas entry below); `kuliah/paparan/script.js` still shows the original "Ceramah Khas — Akan Diumumkan" wording on the signage screen, unchanged (out of scope for the 2026-07-25 Khas work). The point of the whole feature: the public schedule must show *that* a slot exists without ever showing placeholder/undetermined ustaz info as if it were real.

**"Kuliah Khas" special-lecture flag (`subuh_khas`/`maghrib_khas`, added 2026-07-25) — independent of, and NOT mutually exclusive with, the pending flags above:** a checkbox (`subuh-khas-check`/`maghrib-khas-check` in `jadual.html`, next to but not wired into the pending toggle logic) marks a session as a special Khas lecture, whether or not an ustaz is assigned yet. `saveDay()` writes it straight through (no clearing/disabling of the ustaz select — a Khas lecture can have a confirmed speaker). `api/publish.js` merges `khas: true` onto whichever of the 3 existing session shapes already applies. On the public page (`kuliah/jadual/`), this relabels the session to "Kuliah Subuh/Maghrib Khas", colors the day cell purple (desktop + mobile), and toggles a legend entry — see `kuliah/CLAUDE.md`'s "Kuliah Khas special-lecture labeling" section for the full rendering details. **The admin's own calendar reads this flag too (added later):** `jadual.js`'s `renderCalendar()`/`renderMobileDayList()` append a `khas`/`mdc-khas` class onto the existing session-tag markup when `subuh_khas`/`maghrib_khas` is true, styled purple in `admin/style.css` (`#f3e8ff`/`#6b21a8`, matching the public page). `kuliah/paparan/` still doesn't read this flag at all.

**"Ditangguhkan" postponed-slot flag (`subuh_ditangguhkan`/`maghrib_ditangguhkan`, added 2026-09-27):** a checkbox (`subuh-ditangguhkan-check`/`maghrib-ditangguhkan-check` in `jadual.html`, below each Khas checkbox) marks a scheduled slot as postponed when the ustaz cannot attend — keeps the assigned ustaz (same pattern as khas, NOT the pending-clears-select pattern). MAY combine with Khas, MUST NOT combine with Pending (`toggleSubuhDitangguhkan()`/`toggleMaghribDitangguhkan()` uncheck+disable Pending both directions, and vice versa in `toggleSubuhPending()`/`toggleMaghribPending()`). `saveDay()`/`buildDayDiffText()` carry both flags with own `Ditangguhkan (Subuh/Maghrib): Tidak → Ya` diff lines; `countFilledDays()` treats a ditangguhkan-only row as filled; `confirmDuplicate()` copies IDs only so it never carries forward (same rationale as `cuti_umum`). Admin calendar keeps the name and appends `(Ditangguhkan)` in red (`session-tag ditangguhkan` `#fee2e2`/`#b91c1c`, `mdc-ditangguhkan` on mobile — declared after khas so it wins when stacked). **Update 2026-09-27: the follow-up is BUILT — `api/publish.js` merges `ditangguhkan: true`, public `kuliah/jadual/` shows name + red status + legend, `kuliah/paparan/` dims the poster under a `KULIAH DITANGGUHKAN` overlay (see `kuliah/CLAUDE.md`).** Nothing remains open except re-publishing months whose flags were set before this deployed.

**Activity log (`activity_log` table + `logActivity()` in app.js, viewed at `userlog.html`, super_admin only):** every mutating admin action inserts one row right after its write succeeds — schedule day edits, bulk duplicate/clear (one summary row each, not per-date), ustaz create/update/delete, admin-account create/update/delete, and Terbitkan/publish (logged server-side from `api/publish.js` using its existing service-role client, since that write happens outside the browser). `target_label`/`detail` are always plain-text snapshots (an ustaz's `short_name`, an admin's email, a month label) — **never** a live foreign key — so history stays readable even after the referenced ustaz/admin is later renamed or deleted. Each call-site captures its "before" value from an already-loaded in-memory cache (`scheduleMap`, `allUstaz`, `allUsers`) rather than an extra query, builds a diff string via a small pure `build*DiffText()` helper local to that page's JS file, and skips the insert entirely if nothing actually changed (no no-op log rows). `logActivity()` never throws or toasts — a logging failure must never make an admin think their actual save/delete/publish failed.

**Infaq schema matches the real Sheet, not an assumed shape (redesigned 2026-07-21):** the original 2026-07-19 build assumed every donation/expense is entered as an individual raw row. The user then shared the actual live data behind `infaq.mamtj6.com` — general infaq is recorded as **one lump sum per week** (`Tahun/Bulan/Minggu1-5`), expenses as **one lump sum per month**, and only project-earmarked "tabung" donations are genuinely individual dated entries. The schema was rebuilt to match: `infaq_kutipan_mingguan` (tahun/bulan/minggu/jumlah), `infaq_perbelanjaan_bulanan` (tahun/bulan/jumlah), `infaq_projek_kutipan` (tarikh/jumlah/keterangan, project_id required). This was a clean rebuild, not a migration — the original schema was never run against live Supabase. Higher-level rollups (`paparanBulanIni`'s Minggu1-5 buckets, `ringkasan.kutipan`/`.perbelanjaan`'s month/year totals, `graf`'s 12-month series, `dataKumulatif`'s running sum) are still always computed by `api/publish-infaq.js`'s pure, exported helper functions (`sumJumlah`, `filterTahunBulan`, `filterTahun`, `buildMingguBuckets`, `buildYearlyGraf`, `computeCumulative`, `computeProjectProgress` — same "exported for unit-testing without a live deploy" convention as `api/publish.js`) at Terbitkan time, never typed in directly. `admin/infaq/ringkasan.html`'s stat cards preview simple independent sums client-side — deliberately NOT a client-side reimplementation of the full week-bucket/graf logic, same separation of concerns `jadual.js` already has from `api/publish.js`.

**Infaq's weekly/monthly entry pages upsert, they don't insert-only:** `kutipan.js`'s save (on `tahun,bulan,minggu`) and `perbelanjaan.js`'s save (on `tahun,bulan`) both use Supabase `.upsert(payload, { onConflict: '...' })`, not `.insert()`. This matches the real workflow — the committee just records "this week's/month's total," they shouldn't need to remember whether a row already exists for that period. Both pages fetch their entire table once and filter/sum client-side (year filter) rather than server-side pagination — the old per-donation `kutipan.js` needed pagination because it was unbounded; these tables grow by ~1 row/week or ~1 row/month, small enough to hold entirely in memory.

**Infaq project activation must deactivate-then-activate, in that order (partial unique index enforces at most one active project):** `admin/infaq/projek.js`'s `confirmActivate()` runs two sequential `UPDATE`s — the currently-active project first (`is_active: false, completed_at: now()`), then the target (`is_active: true`) — never the reverse, or briefly (between the two statements, if reordered) two rows would both need `is_active = true`, violating `idx_infaq_projects_one_active`. New projects are created with `is_active: false` always — activating is a separate, explicit step, so creating a draft project can never silently deactivate whatever's currently live.

**Infaq's January cumulative edge case (see `api/publish-infaq.js`'s pure functions, unit-tested):** `perbelanjaan.json`'s `paparanBulanLepas.JumlahKumulatif` is a running sum *within one calendar year* (resets at the year boundary). When "now" is January, "bulan lepas" is December of the **previous** year — its cumulative must be computed from that previous year's own 12-month series (`buildYearlyGraf(rows, lastMonthYear)` → `computeCumulative(...)[11]`), never read from the current (new) year's array, which would just show January's own total or zero. Get this wrong and the December-cumulative figure silently resets to near-zero every January 1st.

**`logActivity()` now takes an optional 4th param for the target table (app.js):** `logActivity(action, targetLabel, detail, table = 'activity_log')` — every pre-existing call site is unaffected (table defaults to kuliah's `activity_log`); `admin/infaq/*.js` pass `'infaq_activity_log'` explicitly.

**Online (bank-transfer) donation total — `infaq_projects.online_total`/`online_total_updated_at` (2026-07-24):** a second donation channel `infaq_projek_kutipan` never captured — the physical-tabung log only ever summed to RM 176,314 against the reference site's claimed RM 196,741 for the active project; the RM 20,427 gap turned out to be real, verified-against-the-bank-statement direct transfers, not a bookkeeping error (see `admin/infaq/online-donation-plan.md`). Same shape as `launch_date`: a single overwritable running total + its own "last checked" date, no history table — but edited from `projek-kutipan.js`'s own "Kemaskini Jumlah Online" modal (`openOnlineTotalModal()`/`saveOnlineTotal()`), not `projek.html`'s Add/Edit modal — deliberately kept off that page after building it there first, since the user wanted it editable on the same page it's displayed on, not a separate project-settings screen. **Every "Terkumpul" computation site adds `Number(project.online_total || 0)` to the physical-donations sum** — `projek.js`'s `loadProjects()`, `projek-kutipan.js`'s `updateProgress()`, `ringkasan.js`'s `loadActiveProject()`, `admin/dashboard.js`'s `loadInfaqOverview()`, and `api/publish-infaq.js`'s `computeProjectProgress()` (feeds both `daily.json` and `data.json`) — so the figure can never be inconsistent page-to-page or between the admin CMS and the published JSON. The breakdown line (physical vs. online vs. combined) and the 5-point Nota explaining the online channel are scoped to `projek-kutipan.html` only, and only render once `online_total` is actually set — an unset project still shows just the plain physical-only progress text, unchanged.

**`userlog.html` merges BOTH `activity_log` and `infaq_activity_log` into one timeline (fixed 2026-07-22 — previously infaq's log was write-only, nothing displayed it):** `userlog.js`'s `LOG_SOURCES` array (`[{ module, table, actionLabels }, ...]`) is the single source of truth for which tables feed the page — mirrors `app.js`'s `MODULES` array pattern, so a future third module's own `<module>_activity_log` table is one array entry, not a rewrite. `loadLog()` queries every source in `LOG_SOURCES` in parallel (each capped at `logLimit` — sufficient to guarantee the true merged top-N, since a global top-N can never need more than N rows from any single source), tags each row with its module, then merges and re-sorts by `created_at` so kuliah and infaq events interleave into one real chronological timeline rather than two separate lists a toggle would force apart. A source that errors degrades to an empty list for that source rather than blanking the whole page. The Tindakan filter dropdown groups both modules' actions under `<optgroup>`s built from the same `LOG_SOURCES` array. **Adding a future module's activity log to this page needs zero new grants** — `authenticated` already has `SELECT` on `infaq_activity_log` (proven by `loadLastPublishedInfaqNote()` already reading it from the browser), so this was purely additive to a read-only page; only a genuinely new table (for a genuinely new module) would need the standard new-table `GRANT` treatment below.

**Infaq's publish targets are fully independent, not one combined publish, and each lives on its own data page (2026-07-22, plus the `project` target 2026-09-07):** `api/publish-infaq.js` requires `?target=monthly|daily|perbelanjaan|project`, fetches only the Supabase table(s) that one target needs, and pushes only that one file — so recording an expense never requires also recomputing/republishing kutipan data or vice versa. The fixed-name buttons sit on the page where that data is edited — `kutipan.html` (monthly), `perbelanjaan.html` (perbelanjaan), `projek-kutipan.html` (daily, shown only when viewing the currently-active project, since `daily.json` always reflects that one project) — plus, on `projek-kutipan.html`, a per-project `project` target (`?target=project&project=<uuid>`) shown for **every** project, active OR completed, that writes just that one project's snapshot to `admin/infaq/data/<slugified-name>_<project-uuid>.json`. The `daily` buttons are **not** on `ringkasan.html`, which moved back to a read-only stats overview (2026-07-22, superseding the brief ringkasan-centric design from earlier the same day). The shared plumbing (`publishInfaq(target, btnId)`, `publishInfaqProject(projectId, btnId)`, `loadLastPublishedInfaqNote(action, elId)`, the `PUBLISH_BUTTON_LABELS`/`PUBLISH_NOTE_TARGETS` lookups) lives in `infaq-common.js` so all 4 pages call the same code. Each target logs its own `infaq_activity_log` action (`publish_monthly`/`publish_daily`/`publish_perbelanjaan`/`publish_project`). The `publish_project` note MUST be filtered by `target_label = project.name` (every project shares the `publish_project` action — see `loadLastPublishedProjectNote()`), unlike the others which are unique by action. If you add a future infaq output file, follow this same shape — a new `TARGETS` entry in `api/publish-infaq.js`, a new button + note pair on whichever page owns that data, not a return to one combined endpoint or a centralized publish page.

**Cross-module overview (`admin/dashboard.html`/`.js`, added 2026-07-22):** the universal post-login landing page (see `defaultLandingPageFor` above) — gates each section by the same `role === 'super_admin' || permissions?.X` check `renderSidebar()`/`requireInfaqAccess()` already use, so a kuliah-only admin never sees infaq numbers and vice versa. Every figure is a fresh, independent query against the same tables the full pages already read (`schedule`+`ustaz`, `activity_log`, `infaq_kutipan_mingguan`/`infaq_perbelanjaan_bulanan`/`infaq_projects`/`infaq_projek_kutipan`) — nothing is cached or shared across pages, since this is a plain MPA with no client-side state persistence between page loads. `dashboard.js`'s queries deliberately mirror existing patterns rather than reusing their code directly (different page, no shared module system): the kuliah section mirrors `jadual.js`'s month-bounded `schedule` fetch, its `countFilledDays`-style truthy-field check, and its `activity_log` "last publish for this month's label" lookup; the infaq section is a narrower version of `ringkasan.js`'s `loadStats()`/`loadActiveProject()` — bulan-ini only (no bulan-lepas/tahun breakdown), since this is meant as a glance, not a replacement for `ringkasan.html`'s fuller view. The generic stat-card/progress-bar CSS these both use (`.stat-grid`/`.stat-card`/`.stat-label`/`.stat-value`/`.progress-track`/`.progress-fill`/`.section-header-row`/`.subsection-title`/`.goto-link` in `style.css`) was renamed from an `infaq-`-prefixed set (`ringkasan.html` was its only prior consumer) specifically so `dashboard.html` and `ringkasan.html` share one definition instead of two near-duplicate CSS blocks — if you add a 4th module's own glimpse section later, reuse these same classes rather than inventing new ones.

**News module's dual-auth publish endpoint (`api/publish-news.js`, 2026-07-28) — the first Vercel cron in this repo, and the first publish endpoint with two independent auth paths on one route:** every prior publish endpoint (`api/publish.js`, `api/publish-infaq.js`) only ever accepts `POST` + a Supabase session Bearer token. `api/publish-news.js` also accepts `GET` + `Authorization: Bearer <CRON_SECRET>` — the shape Vercel Cron Jobs itself sends when a `CRON_SECRET` project env var is set (Vercel's own convention, not something this repo invented). **Fails closed:** if `CRON_SECRET` isn't set in the environment, every GET is rejected with a 500, never silently treated as "no auth required" — an admin publish button still works fine via POST regardless of whether the cron path is configured. The GET path publishes BOTH targets in one request (`actor_email: 'vercel-cron'` in `news_activity_log`); the POST path publishes exactly the one `?target=` requested, same as infaq's split. If a future module ever needs a cron too, follow this exact shape (fail-closed GET + CRON_SECRET) rather than inventing a new one.

**The ticker preview panel's pure-logic file lives in `admin/news/`, not `api/` — a genuine repo-wide gotcha, not a style choice:** `admin/news/teks-berjalan.js` needs to run the *exact* scheduling logic `api/publish-news.js` runs (`isActiveNow()`, `buildMovingTextJson()`), so an admin can see what Xibo will actually receive before clicking Terbitkan. The natural move — `<script src="/api/publish-news.js">` — is a real trap: **any file under `api/` is a live Vercel serverless function route**, so a browser `GET` to that URL doesn't serve the file's source, it *invokes the handler* (hitting the fail-closed cron-auth branch and returning JSON, not runnable script). The fix was pulling the pure functions out into `admin/news/publish-news-pure.js` — an ordinary static file with zero Node/Vercel-only APIs, loaded as a plain global script in the browser and pulled in via `require()` from `api/publish-news.js` server-side. **If any future module wants a live client-side preview of server-computed publish logic, this is the pattern: put the pure logic in a static-served path, never inside `api/`.**

**`news_settings`'s service_role grant is the one place a news RLS convention diverges from every other module (see Supabase Schema above):** `api/publish-news.js` isn't purely read-only against Supabase like `api/publish.js`/`api/publish-infaq.js` are — it also writes the khutbah fail-safe cache (`khutbah_last_title`/`khutbah_last_fetched_at`) back into `news_settings` on every successful CSV fetch, so `service_role` needs `INSERT, UPDATE` there in addition to `SELECT`, not the SELECT-only grant every other table's publish-read gets. Documented explicitly in `admin/setup.sql` §10 so it isn't "fixed" back to SELECT-only by someone pattern-matching against the other modules.

**Minute-precision scheduling (`start_at`/`end_at` as `TIMESTAMP`, added same day as the rest of the module, 2026-07-28) — day+hour+minute, deliberately no seconds field:** both news tables started as `DATE` columns (whole-day granularity, matching `kuliah`'s `schedule.date`), then were changed to `TIMESTAMP` after the user confirmed the extra precision was worth it despite the ticker's real-world caveat (below). `admin/news/pengumuman.html`/`teks-berjalan.html`'s modals use `<input type="datetime-local">` (which has no seconds field by construction) instead of `<input type="date">`; the value round-trips as a plain `YYYY-MM-DDTHH:MM` string with no client-side Date-object parsing needed on save. **The date-only *string-comparison* design (see the "must agree with news/script.js" note above) survived the upgrade unchanged in spirit** — `publish-news-pure.js`'s `isActiveNow()` now compares `YYYY-MM-DDTHH:MM` strings via `mytDateTimeString()`/`normalizeBoundary()` instead of `YYYY-MM-DD` strings via `mytDateString()`, same lexicographic-comparison trick, just one more segment. `normalizeBoundary()` still expands a bare `YYYY-MM-DD` value (any pre-migration row, or a future hand-inserted one) to start-of-day/end-of-day exactly as before — full backward compatibility, no forced data cleanup. `news-common.js`'s `computeStatus()` (the admin table's Aktif/Akan Datang/Tamat label) got its own parallel `localDateTimeString()`/`normalizeBoundaryLocal()`, deliberately NOT sharing code with `publish-news-pure.js` — `pengumuman.html` never loads that file, so `news-common.js` (loaded by both pages) has to work standalone. **The live-precision caveat, explained to the user before this was built and accepted as worth it anyway:** announcements get real minute-level scheduling for free, since `news/script.js` already re-evaluates every 60 seconds client-side and its `parseLocalDate()` already accepted a full timestamp even before this change (zero display-side changes needed). The ticker does NOT — `moving-text.json` only updates when something republishes it, so a ticker line's precise start/end time only actually takes effect on the live screen at the next Terbitkan click or the next daily cron run (once/day on Vercel's Hobby plan), not the instant the clock ticks past it. The schema/UI support the precision either way; whether it's *visibly* real-time on the ticker specifically is a hosting-plan/cron-frequency question, not a code one — see the cron Key Patterns entry above.

**Staff login never becomes a Supabase Auth principal — this is the load-bearing security property of the whole `admin/staff/`+`staff/`+`api/staff-login.js` module, not an implementation detail (added 2026-07-29):** every RLS SELECT policy in this repo, on every table, is `TO authenticated USING (true)` — "authenticated" means "holds ANY valid Supabase Auth JWT for this project," never "is a row in `admins`." The `admins` membership check only happens client-side, after the fact, in `app.js`'s `requireAuth()`. The obvious way to add Google login for staff — reusing `db.auth.signInWithOAuth()`, same call `admin/index.html` uses — would be a real confidentiality hole: a staff member's browser would get a genuine `authenticated`-role JWT, and from devtools could query `https://<project>.supabase.co/rest/v1/admins?select=*` (or any other table) directly with that token + the public anon key, reading every admin's email/role/permissions, every donation record, everything. **Fixed by never letting staff touch Supabase Auth at all** — `staff/index.html`'s Google path uses Google Identity Services (`https://accounts.google.com/gsi/client`) directly, independent of Supabase; the browser gets a Google ID token and POSTs it to `/api/staff-login`, which verifies it itself against Google's own `tokeninfo` endpoint. `staff/` never loads the Supabase JS SDK — grep for `supabase-js` in that folder if you ever suspect this rule has been violated, it should find nothing. `api/staff-login.js` uses the service-role key and bypasses RLS entirely for every staff-facing action (same pattern as `api/publish.js`) — RLS on the `staff` table is only ever evaluated for the ADMIN roster-management path (`admin/staff/roster.html`, normal browser + anon key + the admin's own Supabase session). These two paths must stay genuinely disjoint; if you're ever tempted to make them share a login mechanism "for consistency," don't.

**PIN hashing lives in one file, loaded both server-side and browser-side, specifically to eliminate drift risk (`admin/staff/staff-pin-pure.js`, same convention as `admin/news/publish-news-pure.js`):** PBKDF2-HMAC-SHA256 (100k iterations) via the standard Web Crypto API — `generatePinAndHash()` runs in the admin's browser (`roster.js`, "Jana PIN Baharu" button, using `crypto.getRandomValues()` for both the PIN and the salt, never `Math.random()`), `verifyPin()` runs server-side (`api/staff-login.js`, using Node's `crypto.webcrypto.subtle` + `crypto.timingSafeEqual` for the comparison). Because it's the *same source file* required/loaded on both sides (an `isNodeEnv()` guard picks `require('crypto').webcrypto` vs. the browser's global `crypto`), the two can never independently drift out of sync the way two hand-written implementations of "the same algorithm" could. No npm dependency either way — Web Crypto is a browser/Node built-in, consistent with this repo having zero npm dependencies anywhere. Rate-limiting (`LOCKOUT_THRESHOLD = 5`, `LOCKOUT_MINUTES = 15`, also in this file) is the actual defense against a 6-digit PIN's low entropy — enforced exclusively server-side in `api/staff-login.js`, since any client-side limit is trivially bypassable.

**"Single active session" is one overwritable column, not a sessions table (`staff.device_session_token`):** every successful login — PIN or Google, doesn't matter which — issues a fresh `crypto.randomUUID()` and unconditionally overwrites whatever was stored before. That overwrite *is* the entire enforcement mechanism: logging in on a second device silently invalidates the first, with no notification to the now-logged-out device and no admin action needed to "release" anything. Deliberate design, not a gap — see the plan this module was built from. The token has no expiry (`device_session_started_at` is stored precisely so a future feature could add one without a migration). Identity proven via *either* method resets `failed_pin_attempts`/`locked_until` too (`finalizeLogin()` in `api/staff-login.js`) — a successful Google login clears a PIN lockout, an explicit decision, not an oversight.

**The admin roster page's own SELECT deliberately excludes `pin_hash`/`device_session_token`, even though RLS would technically allow fetching them (`roster.js`'s `loadStaff()`):** RLS policies are row-level, not column-level — `admin_can_write('staff')` governs whether a row can be read/written at all, not which columns. Nothing stops an admin from writing a different query that fetches the hash. This is a convention-level exclusion, not a DB-enforced one — the same trust model this repo already accepts for admins seeing other sensitive data (donation records, other admins' emails). Documented here so it isn't mistaken for a real security boundary if this page is ever extended.

**PIN regeneration and lockout-clearing are their own distinct `staff_activity_log` actions (`staff_pin_reset`/`staff_lockout_cleared`), not folded into the generic `staff_update` diff the way `ustaz.js` folds poster changes into `ustaz_update`:** a security-relevant event like "this staff member's PIN was reset" is worth being independently filterable in `userlog.html`'s Tindakan dropdown, not buried inside a combined diff string only visible in the `detail` column. If you add another security-relevant staff action later, follow this same shape — its own action value, not a bullet point inside `staff_update`.

## Sensitive Files

- `admin/` has no config files with secrets — credentials are Vercel env vars
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, never in browser code
- `GITHUB_TOKEN` — Vercel env var only, used in `api/publish.js`
- `GOOGLE_CLIENT_ID` — Vercel env var used by `api/staff-login.js` to verify
  Google ID tokens; NOT secret (Google Client IDs are meant to be
  public/client-side), but must exactly match the same literal value
  hardcoded into `staff/script.js` (that file has no build step to inject
  it automatically — see `staff/CLAUDE.md`'s setup section) or every
  Google login attempt fails
- `CRON_SECRET` — Vercel env var only, used in `api/publish-news.js`'s GET/cron
  auth path (see Key Patterns) — must be set before the `vercel.json` cron is
  enabled, or the fail-closed check rejects every cron run
- Supabase anon key in `app.js` is public (safe — RLS enforces access control)
