-- ─────────────────────────────────────────────────────────────────────────────
-- Admin Kuliah MAMTJ6 — Supabase Setup
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Tables ─────────────────────────────────────────────────────────────────

-- admins: who is allowed to log in and what they can do. Checked by
-- app.js's requireAuth() after every Google OAuth login — an email that
-- isn't in this table gets signed out immediately (see index.html?denied=1).
CREATE TABLE IF NOT EXISTS admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    name        TEXT,
    role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'super_admin')),
    permissions JSONB NOT NULL DEFAULT '{"kuliah": true, "infaq": false}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for a database created before the infaq module existed — the
-- CREATE TABLE above only sets the default for brand-new rows on a
-- from-scratch database. Existing admin rows keep whatever `permissions`
-- they already have (no infaq key at all, which every permissions.infaq
-- check below treats the same as false) until edited via users.html.
ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false}'::jsonb;

CREATE TABLE IF NOT EXISTS ustaz (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_name   TEXT UNIQUE NOT NULL,
    full_name    TEXT NOT NULL,
    tajuk_kuliah TEXT,
    poster_url   TEXT,
    square_url   TEXT,  -- square-ratio poster variant, any resolution, added 2026-07-29 —
                         -- no live consumer yet, see admin/DEV_NOTES.MD
    jawatan      TEXT,  -- penceramah role/title, added 2026-09-12
    profile_url  TEXT,  -- mugshot portrait, added 2026-09-12 (kuliah-assets/profiles/)
    is_public    BOOLEAN NOT NULL DEFAULT true,  -- show in public penceramah list, added 2026-09-12
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for a database where `ustaz` already existed before this column
-- was added — CREATE TABLE IF NOT EXISTS above is a no-op on an existing
-- table, it does not retroactively add new columns.
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS square_url TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS jawatan TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS profile_url TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS schedule (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date             DATE UNIQUE NOT NULL,
    subuh_ustaz_id   UUID REFERENCES ustaz(id) ON DELETE SET NULL,
    maghrib_ustaz_id UUID REFERENCES ustaz(id) ON DELETE SET NULL,
    subuh_pending    BOOLEAN NOT NULL DEFAULT false,  -- slot reserved but ustaz/topic not decided yet ("Belum Ditetapkan")
    maghrib_pending  BOOLEAN NOT NULL DEFAULT false,
    subuh_khas       BOOLEAN NOT NULL DEFAULT false,  -- this session is a special "Kuliah Khas" lecture — independent of
    maghrib_khas     BOOLEAN NOT NULL DEFAULT false,  -- *_pending (a Khas day can have a confirmed ustaz or be pending)
    subuh_ditangguhkan   BOOLEAN NOT NULL DEFAULT false,  -- this session is postponed ("Ditangguhkan") — keeps ustaz, like khas
    maghrib_ditangguhkan BOOLEAN NOT NULL DEFAULT false,  -- MUST NOT combine with *_pending, MAY combine with *_khas
    cuti_umum        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for a database where `schedule` already existed before these two
-- columns were added — CREATE TABLE IF NOT EXISTS above is a no-op on an
-- existing table, it does not retroactively add new columns.
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_pending   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_khas      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_khas    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_ditangguhkan   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_ditangguhkan BOOLEAN NOT NULL DEFAULT false;


-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_schedule_date             ON schedule(date);
CREATE INDEX IF NOT EXISTS idx_schedule_subuh_ustaz_id   ON schedule(subuh_ustaz_id);
CREATE INDEX IF NOT EXISTS idx_schedule_maghrib_ustaz_id ON schedule(maghrib_ustaz_id);


-- ── 3. Row Level Security ─────────────────────────────────────────────────────
-- Blocks anonymous access. Only authenticated (logged-in) users can read/write.
-- IMPORTANT: RLS policies alone are NOT enough — Postgres also requires a
-- separate table-level GRANT before RLS is even evaluated. Every table below
-- gets both a policy AND an explicit GRANT for exactly this reason (see
-- database.md's Troubleshooting section if you ever hit "permission denied
-- for table X" despite a policy existing).

ALTER TABLE admins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ustaz    ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;

-- admins table policies
CREATE POLICY "auth_all_admins" ON admins
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON admins TO authenticated;

-- service_role needs its own SELECT grant too (found 2026-07-22, via
-- userlog.html's merged log view surfacing that every "Terbitkan..." row
-- showed a raw email instead of the registered admin name) — api/publish.js
-- and api/publish-infaq.js both look up the publishing admin's name from
-- this table using the service-role key (server-side, bypasses RLS but
-- still needs the base grant, same as every other table in this file). This
-- table predates that server-side lookup ever existing, so it was never
-- added — a fresh table isn't the only way to hit the "GRANT, not just RLS"
-- landmine documented in §7 below; an old table gaining a NEW caller/role
-- can hit it too. The lookup failed silently (no error, just a null name
-- falling back to the raw email) until this was traced.
GRANT SELECT ON admins TO service_role;

-- ustaz table policies
CREATE POLICY "auth_all_ustaz" ON ustaz
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON ustaz TO authenticated;

-- schedule table policies
CREATE POLICY "auth_all_schedule" ON schedule
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule TO authenticated;


-- ── 4. Storage bucket ─────────────────────────────────────────────────────────
-- Creates the 'kuliah-assets' bucket for poster images.
-- Posters are public (anyone can view), but only authenticated users can upload.

INSERT INTO storage.buckets (id, name, public)
VALUES ('kuliah-assets', 'kuliah-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read of all objects in this bucket
CREATE POLICY "public_read_kuliah_assets" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'kuliah-assets');

-- Allow authenticated users to upload/update/delete
CREATE POLICY "auth_write_kuliah_assets" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'kuliah-assets');

CREATE POLICY "auth_update_kuliah_assets" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'kuliah-assets');

CREATE POLICY "auth_delete_kuliah_assets" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'kuliah-assets');


-- ── 5. Google OAuth setup (manual steps — cannot be done via SQL) ─────────────
--
-- In Supabase Dashboard → Authentication → Providers → Google:
--   1. Enable the Google provider
--   2. Enter your Google OAuth Client ID and Secret
--      (create at: console.cloud.google.com → APIs & Services → Credentials)
--   3. Copy the "Callback URL (for OAuth)" from Supabase and add it to
--      your Google OAuth app's "Authorised redirect URIs"
--
-- In Supabase Dashboard → Authentication → URL Configuration:
--   Add these redirect URLs (replace with your actual domain):
--     https://dev.mamtj6.com/admin/dashboard.html
--     http://localhost:8000/admin/dashboard.html    ← for local dev
--   (dashboard.html is the OAuth redirectTo target as of 2026-07-22 — the
--   universal cross-module overview page, replacing kuliah/jadual.html)


-- ── 5b. Bootstrap the first super_admin (manual, one-time) ────────────────────
-- The `admins` table starts empty, but users.html (where you'd normally add an
-- admin) itself requires being logged in as a super_admin to even load —
-- chicken-and-egg. Break the loop by inserting the very first row directly:
--
-- INSERT INTO admins (email, name, role, permissions) VALUES
--     ('your-email@gmail.com', 'Your Name', 'super_admin', '{"kuliah": true, "infaq": true}'::jsonb);
--
-- The email must exactly match the Google account you'll log in with. After
-- this one row exists, log in once — you'll land in admin/dashboard.html
-- with the "Pengguna" and "Log Aktiviti" sidebar links visible — and manage
-- every admin after that through users.html normally. Never need to run
-- this insert again.


-- ── 6. Sample data (optional) ─────────────────────────────────────────────────
-- Uncomment and adjust to seed your ustaz list from the existing Posters sheet.
-- This is a one-time operation; the admin dashboard handles all future edits.

/*
INSERT INTO ustaz (short_name, full_name, tajuk_kuliah, poster_url) VALUES
    ('UA Hairul',  'Ustaz Hairul Azam',  'Tadabbur ayat-ayat Surah Al-Baqarah',  'https://dev.mamtj6.com/kuliah/assets/poster-kuliah/1920X1080/07_6.-Ustaz-Hairul-Azam.jpg'),
    ('UA Zaidi',   'Ustaz Zaidi Hassan', 'Fiqh Munakahat',                        null)
ON CONFLICT (short_name) DO NOTHING;
*/


-- ── 7. Activity log ───────────────────────────────────────────────────────────
-- Records who changed what across the dashboard (schedule edits, ustaz CRUD,
-- admin-account CRUD, Terbitkan/publish). Written by the client (and by
-- api/publish.js server-side for the publish action) right after each
-- successful write — see admin/app.js's logActivity(). Not run
-- automatically; run this manually in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_activity_log" ON activity_log
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Explicit table-level grants — RLS policies only take effect once the role
-- already has base privileges (see §3's note — don't rely on inherited
-- defaults for any table). `authenticated` is used by every browser write;
-- `service_role` is used by api/publish.js's own log insert (server-side,
-- bypasses RLS but still needs the grant) — both are required or one of the
-- two log paths fails silently.
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_log TO service_role;


-- ── 8. Infaq module ──────────────────────────────────────────────────────────
-- Donation/expense tracking for admin/infaq/. Not run automatically — run
-- this manually in the Supabase SQL editor, same as every section above.
--
-- REDESIGNED 2026-07-21 to match the mosque's real recording pattern (the
-- live infaq.mamtj6.com Sheet), replacing an earlier per-row donation/
-- expense model. If your database already ran that earlier version —
-- it created infaq_projects/infaq_donations/infaq_expenses/
-- infaq_activity_log — do NOT re-run this whole section: infaq_projects
-- and infaq_activity_log are unchanged below (their CREATE POLICY
-- statements will error, "already exists," since Postgres has no
-- IF NOT EXISTS for policies), so only run the three new CREATE TABLE
-- blocks (infaq_kutipan_mingguan / infaq_projek_kutipan /
-- infaq_perbelanjaan_bulanan) plus their own indexes/RLS/policies/grants,
-- then see §8b at the end of this section to drop the now-unused
-- infaq_donations/infaq_expenses tables.

-- infaq_projects: named fundraising campaigns with a target. History is
-- kept — rows are never overwritten when a project ends, only is_active
-- flips. General/unearmarked infaq (infaq_kutipan_mingguan) never touches
-- this table at all — only donations explicitly recorded against a
-- project (infaq_projek_kutipan) count toward its JumlahTerkumpul.
CREATE TABLE IF NOT EXISTS infaq_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
    is_active     BOOLEAN NOT NULL DEFAULT false,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for a database where infaq_projects already existed before
-- this column was added — CREATE TABLE IF NOT EXISTS above is a no-op on
-- an existing table. Nullable, no default: existing projects have no
-- recorded launch date, filled in per-project via projek.html's Edit
-- modal, never backfilled via SQL.
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS launch_date DATE;

-- Online (bank transfer) donation total — a second donation channel the
-- physical-tabung-only infaq_projek_kutipan log never captured (see
-- admin/infaq/online-donation-plan.md for the RM 20,427 reconciliation that
-- motivated this). Single overwritable running total + its own "last
-- checked against the bank statement" date, no history table — same
-- shape/rationale as launch_date above. Both nullable, no default: treated
-- as 0 wherever "Terkumpul" is computed if unset.
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS online_total NUMERIC(12,2);
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS online_total_updated_at DATE;

-- At most one active project at a time. admin/infaq/projek.js's "Jadikan
-- Aktif" action must deactivate the current one BEFORE activating a new
-- one (two sequential updates) so this index is never transiently violated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_infaq_projects_one_active
    ON infaq_projects (is_active) WHERE is_active = true;

-- infaq_kutipan_mingguan: general infaq, one row per week actually
-- collected (matches how the committee really records it — a single lump
-- sum per week, never per-donor). Sparse by design: a week with nothing
-- collected simply has no row, matching the source Sheet's "-" cells.
-- JumlahBulanan/graf/ringkasan are always computed by summing rows in
-- api/publish-infaq.js — never typed in directly.
CREATE TABLE IF NOT EXISTS infaq_kutipan_mingguan (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tahun      INTEGER NOT NULL,
    bulan      INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
    minggu     INTEGER NOT NULL CHECK (minggu BETWEEN 1 AND 5),
    jumlah     NUMERIC(12,2) NOT NULL CHECK (jumlah > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tahun, bulan, minggu)
);

-- infaq_projek_kutipan: individual dated donations earmarked to ONE
-- project (e.g. a building-fund tabung) — unlike general infaq, these are
-- genuinely tracked per deposit. project_id is required: general,
-- unearmarked infaq belongs in infaq_kutipan_mingguan instead. No
-- ON DELETE CASCADE — admin/infaq/projek.js blocks project deletion while
-- any donation still references it, so history is never silently lost.
CREATE TABLE IF NOT EXISTS infaq_projek_kutipan (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES infaq_projects(id),
    tarikh     DATE NOT NULL,
    jumlah     NUMERIC(12,2) NOT NULL CHECK (jumlah > 0),
    keterangan TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- infaq_perbelanjaan_bulanan: expenses, one row per month total — the real
-- Sheet never tracked category/description per expense, only a monthly
-- lump sum, so this matches that exactly. Same sparse-by-design principle
-- as infaq_kutipan_mingguan.
CREATE TABLE IF NOT EXISTS infaq_perbelanjaan_bulanan (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tahun      INTEGER NOT NULL,
    bulan      INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
    jumlah     NUMERIC(12,2) NOT NULL CHECK (jumlah > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tahun, bulan)
);

CREATE INDEX IF NOT EXISTS idx_infaq_kutipan_mingguan_tahun_bulan ON infaq_kutipan_mingguan(tahun, bulan);
CREATE INDEX IF NOT EXISTS idx_infaq_projek_kutipan_project_id    ON infaq_projek_kutipan(project_id);
CREATE INDEX IF NOT EXISTS idx_infaq_projek_kutipan_tarikh        ON infaq_projek_kutipan(tarikh);
CREATE INDEX IF NOT EXISTS idx_infaq_perbelanjaan_bulanan_tahun   ON infaq_perbelanjaan_bulanan(tahun);

ALTER TABLE infaq_projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE infaq_kutipan_mingguan     ENABLE ROW LEVEL SECURITY;
ALTER TABLE infaq_projek_kutipan       ENABLE ROW LEVEL SECURITY;
ALTER TABLE infaq_perbelanjaan_bulanan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_infaq_projects" ON infaq_projects
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_infaq_projek_kutipan" ON infaq_projek_kutipan
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_projects             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_kutipan_mingguan     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_projek_kutipan       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_perbelanjaan_bulanan TO authenticated;

-- api/publish-infaq.js reads all four via the service-role key to compute
-- the published JSON — per §3's rule (new tables never inherit grants),
-- this must be explicit, not assumed. Read-only: publish never writes to
-- these tables, so SELECT is all service_role needs here.
GRANT SELECT ON infaq_projects, infaq_kutipan_mingguan, infaq_projek_kutipan, infaq_perbelanjaan_bulanan TO service_role;

-- infaq_activity_log: a SEPARATE table from activity_log (kuliah's), by
-- deliberate choice — independent auditability for money data. Same
-- plain-text-snapshot shape/reasoning as activity_log (see §7).
CREATE TABLE IF NOT EXISTS infaq_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_infaq_activity_log_created_at ON infaq_activity_log(created_at DESC);

ALTER TABLE infaq_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_infaq_activity_log" ON infaq_activity_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Both grants required, same reasoning as activity_log's: `authenticated`
-- for browser writes (admin/infaq/*.js), `service_role` for
-- api/publish-infaq.js's own log insert (server-side, bypasses RLS but
-- still needs the grant).
GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON infaq_activity_log TO service_role;


-- ── 8b. One-time cleanup: pre-2026-07-21 infaq tables ─────────────────────────
-- Only relevant if your database ran the OLD version of §8 (see the note at
-- the top of §8) — drops the per-row donation/expense tables that version
-- created, now unused after the redesign. Safe no-op (IF EXISTS) on a
-- database that never had them, e.g. a fresh setup that only ever ran the
-- current §8 above. Irreversible — check Supabase's Table Editor first if
-- you're not sure whether infaq_donations/infaq_expenses hold real data.
DROP TABLE IF EXISTS infaq_donations CASCADE;
DROP TABLE IF EXISTS infaq_expenses CASCADE;


-- ── 9. Viewer role + write-gated RLS ───────────────────────────────────────────
-- Adds a 3rd `role` value ('viewer') that can see whatever `permissions`
-- already grants it, but can never write. Until now, EVERY policy in this
-- file has been `FOR ALL ... USING (true) WITH CHECK (true)` — i.e. role
-- and permissions were purely a client-side (admin/app.js) concern; any
-- authenticated admin could INSERT/UPDATE/DELETE on any table via a raw
-- Supabase API call regardless of role, including `admins` itself (a
-- non-super_admin could grant themselves super_admin today). This section
-- replaces the single permissive policy on every data table with 4
-- separate policies (SELECT/INSERT/UPDATE/DELETE) so writes are actually
-- enforced in Postgres, not just hidden in the UI. See admin/CLAUDE.md's
-- "Module permission gate" and admin/database.md §3 for the client-side
-- half (requireModuleAccess()/canWriteModule() in app.js) this pairs with.
--
-- Deliberately UNCHANGED: activity_log / infaq_activity_log (§7 / §8) keep
-- their original open policy — logActivity() is fire-and-forget from many
-- call sites across every role, and a viewer's real writes are already
-- blocked on every data table above, so a spoofed log row from a direct
-- API call is inert noise, not a security hole. Gating these risked
-- silently swallowing a legitimate editor's own audit entry instead.
--
-- BEFORE RUNNING: the role CHECK below assumes Postgres auto-named the
-- original inline constraint (§1) `admins_role_check`. Verify first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'admins'::regclass AND contype = 'c';
-- If the real name differs, substitute it in the DROP CONSTRAINT line.

-- 9.1 Extend the role CHECK constraint.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
    CHECK (role IN ('editor', 'super_admin', 'viewer'));

-- 9.2 RLS helper functions. SECURITY DEFINER: runs as the function owner,
-- not the calling `authenticated` role — needed so this can read `admins`
-- (itself RLS-protected) without recursing into the very policies it's
-- used by. SET search_path = public closes the classic SECURITY DEFINER
-- search_path-hijack hole. STABLE lets Postgres cache the result within
-- one statement. ILIKE (not =) on email — same reasoning as
-- api/publish.js's admin lookup and admin/app.js's client-side checks:
-- admins.email may not casing-match what Google OAuth/auth.email()
-- returns, and a plain `=` mismatch fails silently (zero rows, no error)
-- rather than erroring.
CREATE OR REPLACE FUNCTION public.admin_can_write(module_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT role = 'super_admin'
                   OR (role = 'editor' AND (permissions ->> module_key)::boolean IS TRUE)
            FROM admins
            WHERE email ILIKE auth.email()
            LIMIT 1
        ),
        false
    );
$$;

REVOKE ALL ON FUNCTION public.admin_can_write(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_can_write(text) TO authenticated;

-- Separate helper for admins-table writes (super_admin-only, no module key).
CREATE OR REPLACE FUNCTION public.admin_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT role = 'super_admin' FROM admins WHERE email ILIKE auth.email() LIMIT 1),
        false
    );
$$;

REVOKE ALL ON FUNCTION public.admin_is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_is_super_admin() TO authenticated;

-- 9.3 admins: tighten writes to super_admin only. SELECT stays open —
-- several pages read admins.name for "last published by" lookups
-- regardless of the reading admin's own role (jadual.js's
-- loadLastPublishedNote(), infaq-common.js's loadLastPublishedInfaqNote()).
-- This closes the gap where any authenticated admin could otherwise write
-- to `admins` directly via a raw API call — including self-promoting to
-- super_admin — bypassing users.html's own client-side "must already be
-- super_admin to load this page" gate entirely.
DROP POLICY IF EXISTS "auth_all_admins" ON admins;

CREATE POLICY "auth_select_admins" ON admins
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "super_admin_insert_admins" ON admins
    FOR INSERT TO authenticated WITH CHECK (public.admin_is_super_admin());

CREATE POLICY "super_admin_update_admins" ON admins
    FOR UPDATE TO authenticated
    USING (public.admin_is_super_admin())
    WITH CHECK (public.admin_is_super_admin());

CREATE POLICY "super_admin_delete_admins" ON admins
    FOR DELETE TO authenticated USING (public.admin_is_super_admin());

-- 9.4 kuliah tables: SELECT open, writes gated on permissions.kuliah (or super_admin).
DROP POLICY IF EXISTS "auth_all_ustaz" ON ustaz;
CREATE POLICY "auth_select_ustaz" ON ustaz FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_ustaz" ON ustaz FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('kuliah'));
CREATE POLICY "auth_update_ustaz" ON ustaz FOR UPDATE TO authenticated
    USING (public.admin_can_write('kuliah')) WITH CHECK (public.admin_can_write('kuliah'));
CREATE POLICY "auth_delete_ustaz" ON ustaz FOR DELETE TO authenticated
    USING (public.admin_can_write('kuliah'));

DROP POLICY IF EXISTS "auth_all_schedule" ON schedule;
CREATE POLICY "auth_select_schedule" ON schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_schedule" ON schedule FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('kuliah'));
CREATE POLICY "auth_update_schedule" ON schedule FOR UPDATE TO authenticated
    USING (public.admin_can_write('kuliah')) WITH CHECK (public.admin_can_write('kuliah'));
CREATE POLICY "auth_delete_schedule" ON schedule FOR DELETE TO authenticated
    USING (public.admin_can_write('kuliah'));

-- 9.5 infaq tables: same shape, gated on permissions.infaq.
DROP POLICY IF EXISTS "auth_all_infaq_projects" ON infaq_projects;
CREATE POLICY "auth_select_infaq_projects" ON infaq_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_infaq_projects" ON infaq_projects FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_update_infaq_projects" ON infaq_projects FOR UPDATE TO authenticated
    USING (public.admin_can_write('infaq')) WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_delete_infaq_projects" ON infaq_projects FOR DELETE TO authenticated
    USING (public.admin_can_write('infaq'));

DROP POLICY IF EXISTS "auth_all_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan;
CREATE POLICY "auth_select_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_update_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan FOR UPDATE TO authenticated
    USING (public.admin_can_write('infaq')) WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_delete_infaq_kutipan_mingguan" ON infaq_kutipan_mingguan FOR DELETE TO authenticated
    USING (public.admin_can_write('infaq'));

DROP POLICY IF EXISTS "auth_all_infaq_projek_kutipan" ON infaq_projek_kutipan;
CREATE POLICY "auth_select_infaq_projek_kutipan" ON infaq_projek_kutipan FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_infaq_projek_kutipan" ON infaq_projek_kutipan FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_update_infaq_projek_kutipan" ON infaq_projek_kutipan FOR UPDATE TO authenticated
    USING (public.admin_can_write('infaq')) WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_delete_infaq_projek_kutipan" ON infaq_projek_kutipan FOR DELETE TO authenticated
    USING (public.admin_can_write('infaq'));

DROP POLICY IF EXISTS "auth_all_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan;
CREATE POLICY "auth_select_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_update_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan FOR UPDATE TO authenticated
    USING (public.admin_can_write('infaq')) WITH CHECK (public.admin_can_write('infaq'));
CREATE POLICY "auth_delete_infaq_perbelanjaan_bulanan" ON infaq_perbelanjaan_bulanan FOR DELETE TO authenticated
    USING (public.admin_can_write('infaq'));

-- 9.6 api/publish.js and api/publish-infaq.js are unaffected by all of the
-- above — both use the service_role key server-side, which bypasses RLS
-- entirely (RLS only ever applies to the `authenticated`/`anon` roles).


-- ── 10. News module ───────────────────────────────────────────────────────────
-- Pengumuman (announcement slides) + Teks Berjalan (Xibo ticker) for
-- admin/news/, retiring the old Google Sheet → Apps Script → GitHub pipeline
-- (news/moving-text/code.gs) that shipped a raw "ERROR: ... Status: 503"
-- string to the live ticker for 3 weeks unnoticed — see news/newplan.md and
-- api/publish-news.js's khutbah-resolution comment for the fail-safe this
-- motivated. Not run automatically — run manually in the Supabase SQL
-- editor, same as every section above. Written directly against the §9
-- write-gated model (admin_can_write()/RLS already exist by this point in
-- the script) rather than the old open-FOR-ALL-then-migrate two-step §8's
-- infaq tables had to go through — a brand-new module added today starts
-- gated from its first CREATE POLICY.

-- news_announcements → news/data/announcements.json (read by news/script.js
-- directly — our own JS resolves start_at/end_at scheduling client-side, on
-- the display device's own clock, unlike news_ticker below).
--
-- start_at/end_at are TIMESTAMP (not DATE, added 2026-07-28 same day as the
-- rest of this module — day+hour+minute scheduling, no seconds field since
-- nothing here ever needs second-level precision) — "no time zone" is
-- deliberate: these are treated as naive Malaysia wall-clock values, same
-- as every other date-ish field in this repo (see root CLAUDE.md's Date
-- handling pattern), never converted through a real tz. A bare date-only
-- value (e.g. from an old row, or a future hand-insert) still works fine —
-- Postgres reads it as midnight, and news/script.js's parseLocalDate() /
-- api/publish-news.js's normalizeBoundary() both still expand a bare date
-- to the full day exactly as before.
CREATE TABLE IF NOT EXISTS news_announcements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,               -- internal label, also published as JSON "title"
    heading    TEXT,
    body_text  TEXT,                        -- maps to published JSON "text"
    image_url  TEXT,
    start_at   TIMESTAMP,
    end_at     TIMESTAMP,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Mirrors news/script.js's isActive(): an entry with neither field can
    -- never display anything, so it's rejected here, not just silently
    -- published as a blank slide.
    CONSTRAINT news_announcements_has_content CHECK (image_url IS NOT NULL OR body_text IS NOT NULL)
);

-- news_ticker → news/data/moving-text.json, read DIRECTLY by Xibo's DataSet
-- widget (no JS of ours runs there) — so unlike news_announcements,
-- start_at/end_at/enabled are resolved SERVER-SIDE by api/publish-news.js
-- at publish time, not on the display. An expired ticker line only
-- disappears when something republishes it — see the daily cron in
-- vercel.json. Same TIMESTAMP (not DATE) reasoning as news_announcements
-- above applies here too.
CREATE TABLE IF NOT EXISTS news_ticker (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message    TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'khutbah')),
    prefix     TEXT,                        -- khutbah rows only, e.g. 'Khutbah Jumaat Minggu Ini: '
    start_at   TIMESTAMP,
    end_at     TIMESTAMP,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for a database that already ran §10 above with start_at/end_at
-- as DATE (i.e. any database that ran this section before 2026-07-28) —
-- CREATE TABLE IF NOT EXISTS is a no-op on an existing table, it does not
-- retroactively change a column's type. Safe to run even if start_at/end_at
-- are already TIMESTAMP (changing a column to its own type is a no-op, not
-- an error), so this is safe to re-run / run on a brand-new §10 install too.
-- end_at's USING clause is the one part that ISN'T a no-op detail: a
-- date-only end_at used to mean "valid through the end of that day," so
-- casting it straight to TIMESTAMP (which lands on that day's midnight,
-- 00:00) would silently shift every existing row's expiry almost a full day
-- earlier the moment this runs. Adding 23:59 preserves the original
-- meaning; start_at needs no such adjustment since "start of that day" was
-- already midnight.
ALTER TABLE news_announcements ALTER COLUMN start_at TYPE TIMESTAMP;
ALTER TABLE news_announcements ALTER COLUMN end_at   TYPE TIMESTAMP USING (end_at::timestamp + INTERVAL '23 hours 59 minutes');
ALTER TABLE news_ticker        ALTER COLUMN start_at TYPE TIMESTAMP;
ALTER TABLE news_ticker        ALTER COLUMN end_at   TYPE TIMESTAMP USING (end_at::timestamp + INTERVAL '23 hours 59 minutes');

-- news_settings: key/value store so defaults/URLs aren't hardcoded into
-- api/publish-news.js. Seeded below — admin/news/'s Tetapan cards UPDATE
-- these rows in normal use, they don't insert new keys.
CREATE TABLE IF NOT EXISTS news_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- khutbah_csv_url is the same published CSV khutbah/index.html already
-- reads reliably (see its own quote-aware parseCSVRow()) — a different,
-- better source than whatever formula was feeding the old Sheet cell.
INSERT INTO news_settings (key, value) VALUES
    ('default_image',          '/news/default.svg'),
    ('default_ticker_line',    'Selamat datang ke Masjid Al-Mukhlisin Taman Jaya 6'),
    ('khutbah_csv_url',        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQDFOdEOVKqjeS1mErtCrV-Z1-dvArp3wteWAEyRM6KKzXN90yggh0Bc7Nq3yhYKdAEo1NkAiV3lZGd/pub?gid=0&single=true&output=csv'),
    ('khutbah_last_title',     ''),
    ('khutbah_last_fetched_at', '')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_news_announcements_sort ON news_announcements(sort_order);
CREATE INDEX IF NOT EXISTS idx_news_ticker_sort         ON news_ticker(sort_order);

ALTER TABLE news_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_ticker        ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_settings      ENABLE ROW LEVEL SECURITY;

-- SELECT open (any authenticated admin can see news data regardless of
-- permissions.news, same as every other module's data tables — see §9),
-- writes gated on admin_can_write('news').
CREATE POLICY "auth_select_news_announcements" ON news_announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_news_announcements" ON news_announcements FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_update_news_announcements" ON news_announcements FOR UPDATE TO authenticated
    USING (public.admin_can_write('news')) WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_delete_news_announcements" ON news_announcements FOR DELETE TO authenticated
    USING (public.admin_can_write('news'));

CREATE POLICY "auth_select_news_ticker" ON news_ticker FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_news_ticker" ON news_ticker FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_update_news_ticker" ON news_ticker FOR UPDATE TO authenticated
    USING (public.admin_can_write('news')) WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_delete_news_ticker" ON news_ticker FOR DELETE TO authenticated
    USING (public.admin_can_write('news'));

CREATE POLICY "auth_select_news_settings" ON news_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_news_settings" ON news_settings FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_update_news_settings" ON news_settings FOR UPDATE TO authenticated
    USING (public.admin_can_write('news')) WITH CHECK (public.admin_can_write('news'));
CREATE POLICY "auth_delete_news_settings" ON news_settings FOR DELETE TO authenticated
    USING (public.admin_can_write('news'));

GRANT SELECT, INSERT, UPDATE, DELETE ON news_announcements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON news_ticker        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON news_settings       TO authenticated;

-- api/publish-news.js reads news_announcements/news_ticker (SELECT only —
-- publish never writes them) via the service-role key. news_settings is the
-- ONE place this diverges from infaq's publish grants: the endpoint also
-- WRITES news_settings.khutbah_last_title/khutbah_last_fetched_at back as
-- the fail-safe cache (see api/publish-news.js's khutbah resolution), so
-- service_role needs INSERT/UPDATE there too, not just SELECT.
GRANT SELECT ON news_announcements, news_ticker TO service_role;
GRANT SELECT, INSERT, UPDATE ON news_settings TO service_role;

-- news_activity_log: verbatim copy of infaq_activity_log's template — its
-- own table (independent auditability, same reasoning as infaq), open
-- FOR ALL policy (logActivity() is fire-and-forget from many call
-- sites/roles — see database.md §3 for why activity-log tables are
-- deliberately left ungated even after §9's write-gating pass).
CREATE TABLE IF NOT EXISTS news_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_activity_log_created_at ON news_activity_log(created_at DESC);

ALTER TABLE news_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_news_activity_log" ON news_activity_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON news_activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON news_activity_log TO service_role;

-- Extend admins.permissions default so a from-scratch database (or any
-- admin row created after this point) includes the news flag — existing
-- rows keep whatever permissions they already have (a missing "news" key
-- reads false everywhere permissions.news is checked), same migration
-- shape as §8's infaq addition.
ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false, "news": false}'::jsonb;

-- news-assets storage bucket: announcement images. Public read,
-- authenticated write — same 4-policy shape as §4's kuliah-assets (not
-- module-gated at the storage-policy level, matching that bucket's own
-- precedent). Path convention: announcements/<slug>-<Date.now()>.<ext>
-- (see admin/news/pengumuman.js).
INSERT INTO storage.buckets (id, name, public)
VALUES ('news-assets', 'news-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_news_assets" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'news-assets');

CREATE POLICY "auth_write_news_assets" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'news-assets');

CREATE POLICY "auth_update_news_assets" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'news-assets');

CREATE POLICY "auth_delete_news_assets" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'news-assets');


-- ── 11. Staff identity/login module ─────────────────────────────────────────
-- Staff (cleaners/guards/etc) are a workforce distinct from `admins` — no
-- role/permission granularity, any registered staff member can log in via
-- either method (PIN or Google), no per-staff assignment. This module is
-- IDENTITY/LOGIN ONLY — the actual geolocation clock-in punch is a
-- deliberately separate, future addition; nothing here writes an
-- attendance record.
--
-- Two completely disjoint access paths — do not conflate them:
--   1. Admin manages the staff roster (admin/staff/roster.html) — normal
--      browser + anon key + the admin's own Supabase Auth session, gated
--      by admin_can_write('staff') exactly like every other module (§9).
--   2. Staff logs in (staff/index.html, served at /staff → POST
--      /api/staff-login) — the browser NEVER creates a Supabase Auth
--      session for a staff member.
--      The Google path uses Google Identity Services directly, verified
--      server-side against Google's own tokeninfo endpoint — NOT
--      db.auth.signInWithOAuth(). Every SELECT policy in this repo is
--      `TO authenticated USING (true)`, meaning "holds ANY valid Supabase
--      Auth JWT for this project" — NOT "is a row in admins". If a staff
--      member's browser ever called signInWithOAuth(), they'd get a real
--      authenticated-role JWT capable of reading every table in this
--      database (admins, infaq donations, everything), regardless of
--      permissions — the admins-table check only happens client-side,
--      after the fact, in app.js's requireAuth(). api/staff-login.js uses
--      the service-role key, bypassing RLS entirely, same pattern as
--      api/publish.js. RLS below is relevant ONLY to path 1.

CREATE TABLE IF NOT EXISTS staff (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name                  TEXT NOT NULL,
    phone                      TEXT,
    email                      TEXT,               -- nullable; matched ONLY against a verified Google identity (ILIKE)
    pin_hash                   TEXT,                -- 'salt_hex:hash_hex' — PBKDF2-HMAC-SHA256, 100k iterations
    device_session_token       TEXT,                -- nullable; overwritten wholesale on every successful login —
                                                      -- this IS the "single active session" mechanism: whichever
                                                      -- token is currently stored is the only valid one
    device_session_started_at  TIMESTAMPTZ,
    failed_pin_attempts        INTEGER NOT NULL DEFAULT 0,
    locked_until                TIMESTAMPTZ,
    enabled                     BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (email);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

-- Path 1 only (admin roster CRUD). Same 4-policy shape as every §9/§10 module.
CREATE POLICY "auth_select_staff" ON staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_staff" ON staff FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('staff'));
CREATE POLICY "auth_update_staff" ON staff FOR UPDATE TO authenticated
    USING (public.admin_can_write('staff')) WITH CHECK (public.admin_can_write('staff'));
CREATE POLICY "auth_delete_staff" ON staff FOR DELETE TO authenticated
    USING (public.admin_can_write('staff'));

GRANT SELECT, INSERT, UPDATE, DELETE ON staff TO authenticated;

-- DIVERGES from every prior publish-style service_role grant (SELECT-only,
-- or SELECT+INSERT/UPDATE for news_settings' cache write-back only):
-- api/staff-login.js's PRIMARY job is writing lockout counters and the
-- session token, so service_role needs UPDATE here, not just SELECT. Do
-- NOT narrow this to SELECT-only by pattern-matching against
-- publish.js/publish-infaq.js — that would silently break login.
GRANT SELECT, UPDATE ON staff TO service_role;

-- staff_activity_log: ADMIN-ACCOUNTABILITY ONLY (staff_create/update/
-- delete/pin_reset/lockout_cleared — admin actions on the roster),
-- deliberately NOT a per-login-attempt security log. Login-attempt
-- telemetry is a different concern (staff security, not admin
-- accountability) than every other *_activity_log table models — the
-- live staff.failed_pin_attempts/locked_until columns already give
-- roster.html everything it needs to react. Same plain-text-snapshot,
-- never-a-FK convention as every other activity log in this repo.
CREATE TABLE IF NOT EXISTS staff_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,   -- the ADMIN performing the roster action, never the staff member
    actor_name   TEXT,
    action       TEXT NOT NULL,   -- staff_create | staff_update | staff_delete |
                                   -- staff_pin_reset | staff_lockout_cleared
    target_label TEXT,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_created_at ON staff_activity_log(created_at DESC);

ALTER TABLE staff_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_staff_activity_log" ON staff_activity_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_activity_log TO authenticated;
-- No service_role grant — unlike activity_log/infaq_activity_log/
-- news_activity_log, api/staff-login.js deliberately does NOT write here
-- (see the no-login-telemetry decision above). Only add this grant if
-- that decision is later reversed.

-- Extend admins.permissions default so a fresh admin row includes the
-- staff flag — existing rows keep whatever permissions they already have
-- (a missing "staff" key reads false everywhere it's checked), same
-- migration shape as every prior module addition.
ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false, "news": false, "staff": false}'::jsonb;


-- ── 12. Khutbah module ────────────────────────────────────────────────────
-- Mimbar Jumaat weekly sermon display (khutbah/paparan-tajuk.html), retiring
-- the Google Sheet → Apps Script → CSV pipeline
-- (khutbah/google_app_script/*.gs). That pipeline's bridge was a live Sheet
-- formula (tajuk khutbah!A2 ='link extractor'!A2) — any hand-correction of
-- the URL replaced the formula with a plain value and silently broke
-- automation until re-entered, and formula recalc never fires onEdit, so the
-- cascade had to be a direct call. See khutbah/DEV_NOTES.md + khutbah/upgrade-plan.md.
-- Not run automatically — run manually in the Supabase SQL editor, same as
-- every section above. Written directly against the §9 write-gated model
-- (admin_can_write()/RLS already exist by this point): a brand-new module
-- starts gated from its first CREATE POLICY.
--
-- khutbah_weeks: one row per Friday (friday_date is the conflict key).
-- Automation-first: the Mon-9am cron (api/publish-khutbah.js) upserts the
-- row for getNextFriday(); manual_override=true locks the row — the cron
-- writes skipped_locked and leaves values untouched until unlocked. This
-- explicit flag replaces the old implicit formula/value distinction.
-- scrape_status: ok | fetch_failed | parse_failed | skipped_locked.
-- On ANY failure the published JSON keeps last-good values — an error string
-- is recorded in scrape_error only, never published (same fail-safe rule as
-- api/publish-news.js's khutbah resolution).
CREATE TABLE IF NOT EXISTS khutbah_weeks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    friday_date      DATE UNIQUE NOT NULL,
    source_url       TEXT NOT NULL,
    siri_text        TEXT NOT NULL,   -- MIMBAR JUMAAT SIRI {M} | {YYYY}, from the Friday's own date
    title            TEXT,            -- scraped; null until first successful scrape
    date_text        TEXT,            -- scraped date string from mufti page
    main_text        TEXT,            -- sermon theme/text (manual or future scrape)
    hijri_part       TEXT,            -- audit/debug: hijri slug segment used in the built URL
    gregorian_part   TEXT,            -- audit/debug: gregorian slug segment used in the built URL
    manual_override  BOOLEAN NOT NULL DEFAULT false,
    scrape_status    TEXT,
    scrape_error     TEXT,
    fetched_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- khutbah_settings: key/value store so alert recipients/sender aren't
-- hardcoded into api/publish-khutbah.js. Seeded below — admin/khutbah/'s
-- Tetapan card UPDATEs these rows in normal use, it doesn't insert new keys.
-- alert_emails: comma-separated list ("" = no mail); last_alert_at/reason
-- are the spam guard (transition-only + 24h throttle), written back by the
-- publish endpoint on every alert decision.
CREATE TABLE IF NOT EXISTS khutbah_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO khutbah_settings (key, value) VALUES
    ('alert_emails',      ''),
    ('alert_from',        'noreply@mamtj6.com'),
    ('last_alert_at',     ''),
    ('last_alert_reason', '')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_khutbah_weeks_friday_date ON khutbah_weeks(friday_date DESC);

ALTER TABLE khutbah_weeks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE khutbah_settings ENABLE ROW LEVEL SECURITY;

-- SELECT open (any authenticated admin can see khutbah data regardless of
-- permissions.khutbah, same as every other module's data tables — see §9),
-- writes gated on admin_can_write('khutbah').
CREATE POLICY "auth_select_khutbah_weeks" ON khutbah_weeks FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_khutbah_weeks" ON khutbah_weeks FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('khutbah'));
CREATE POLICY "auth_update_khutbah_weeks" ON khutbah_weeks FOR UPDATE TO authenticated
    USING (public.admin_can_write('khutbah')) WITH CHECK (public.admin_can_write('khutbah'));
CREATE POLICY "auth_delete_khutbah_weeks" ON khutbah_weeks FOR DELETE TO authenticated
    USING (public.admin_can_write('khutbah'));

CREATE POLICY "auth_select_khutbah_settings" ON khutbah_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_khutbah_settings" ON khutbah_settings FOR INSERT TO authenticated
    WITH CHECK (public.admin_can_write('khutbah'));
CREATE POLICY "auth_update_khutbah_settings" ON khutbah_settings FOR UPDATE TO authenticated
    USING (public.admin_can_write('khutbah')) WITH CHECK (public.admin_can_write('khutbah'));
CREATE POLICY "auth_delete_khutbah_settings" ON khutbah_settings FOR DELETE TO authenticated
    USING (public.admin_can_write('khutbah'));

GRANT SELECT, INSERT, UPDATE, DELETE ON khutbah_weeks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON khutbah_settings TO authenticated;

-- api/publish-khutbah.js reads khutbah_weeks but ALSO writes it (cron upsert
-- of the week's row) and writes khutbah_settings.last_alert_at/reason back
-- as the alert spam-guard cache — so service_role needs INSERT/UPDATE on
-- both, not the SELECT-only grant a pure-read publish gets. Same documented
-- divergence as news_settings (§10); do NOT narrow these to SELECT-only by
-- pattern-matching against publish.js/publish-infaq.js.
GRANT SELECT, INSERT, UPDATE ON khutbah_weeks TO service_role;
GRANT SELECT, INSERT, UPDATE ON khutbah_settings TO service_role;

-- khutbah_activity_log: verbatim copy of news_activity_log's template — its
-- own table (independent auditability, same reasoning as infaq/news), open
-- FOR ALL policy (logActivity() is fire-and-forget from many call
-- sites/roles — see database.md §3 for why activity-log tables are
-- deliberately left ungated even after §9's write-gating pass).
CREATE TABLE IF NOT EXISTS khutbah_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,   -- khutbah_auto_generate | khutbah_scrape_ok |
                                 -- khutbah_scrape_failed | khutbah_manual_update |
                                 -- khutbah_lock | khutbah_unlock | publish_khutbah
    target_label TEXT,            -- friday_date (YYYY-MM-DD), plain-text snapshot, never a FK
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_khutbah_activity_log_created_at ON khutbah_activity_log(created_at DESC);

ALTER TABLE khutbah_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_khutbah_activity_log" ON khutbah_activity_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON khutbah_activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON khutbah_activity_log TO service_role;

-- Extend admins.permissions default so a fresh admin row includes the
-- khutbah flag — existing rows keep whatever permissions they already have
-- (a missing "khutbah" key reads false everywhere it's checked), same
-- migration shape as every prior module addition.
ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false, "news": false, "staff": false, "khutbah": false}'::jsonb;


-- ── 13. Kalendar module (calendar/hijri) ────────────────────────────────────
-- Permission-gated editor for calendar/hijri/data/events.json, replacing the
-- standalone PIN page (calendar/hijri/data/index.html + EVENTS_ADMIN_PIN).
-- No Supabase data table — events.json on GitHub stays the single source of
-- truth; this section only adds the audit log + permissions default.
-- Run manually in the Supabase SQL editor, same as every section above.
CREATE TABLE IF NOT EXISTS calendar_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,   -- calendar_update | publish_calendar
    target_label TEXT,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_activity_log_created_at ON calendar_activity_log(created_at DESC);

ALTER TABLE calendar_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_calendar_activity_log" ON calendar_activity_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_activity_log TO service_role;

ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false, "news": false, "staff": false, "khutbah": false, "kalendar": false}'::jsonb;
