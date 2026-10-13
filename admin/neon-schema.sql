-- ─────────────────────────────────────────────────────────────────────────────
-- MAMTJ6 — Neon (plain Postgres) schema
-- Ported from admin/setup.sql (Supabase) on 2026-10-13.
-- STRIPPED for Neon: RLS policies, GRANTs to authenticated/service_role,
-- storage.buckets / storage.objects (no Storage in Neon — posters live in
-- the GitHub repo, see poster note below), auth.email() helpers
-- (admin_can_write/admin_is_super_admin — enforced in the Vercel API layer
-- instead), Google OAuth manual steps.
-- KEPT 1:1: all 19 tables, columns, UNIQUE/CHECK constraints, indexes, seeds.
--
-- Run in: Neon Dashboard → SQL Editor → paste whole file → Run.
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING throughout).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── admins ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    name        TEXT,
    role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'super_admin', 'viewer')),
    permissions JSONB NOT NULL DEFAULT '{"kuliah": true, "infaq": false, "news": false, "staff": false, "khutbah": false, "kalendar": false}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Existing DBs: widen role check + default (CREATE TABLE is a no-op there).
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
    CHECK (role IN ('editor', 'super_admin', 'viewer'));
ALTER TABLE admins ALTER COLUMN permissions SET DEFAULT '{"kuliah": true, "infaq": false, "news": false, "staff": false, "khutbah": false, "kalendar": false}'::jsonb;

-- ── kuliah ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ustaz (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_name   TEXT UNIQUE NOT NULL,
    full_name    TEXT NOT NULL,
    tajuk_kuliah TEXT,
    poster_url   TEXT,   -- path in GitHub repo, e.g. /kuliah/assets/poster-kuliah/xxx.jpg
    square_url   TEXT,
    jawatan      TEXT,
    profile_url  TEXT,
    is_public    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS square_url TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS jawatan TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS profile_url TEXT;
ALTER TABLE ustaz ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS schedule (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date             DATE UNIQUE NOT NULL,
    subuh_ustaz_id   UUID REFERENCES ustaz(id) ON DELETE SET NULL,
    maghrib_ustaz_id UUID REFERENCES ustaz(id) ON DELETE SET NULL,
    subuh_pending    BOOLEAN NOT NULL DEFAULT false,
    maghrib_pending  BOOLEAN NOT NULL DEFAULT false,
    subuh_khas       BOOLEAN NOT NULL DEFAULT false,
    maghrib_khas     BOOLEAN NOT NULL DEFAULT false,
    subuh_ditangguhkan   BOOLEAN NOT NULL DEFAULT false,
    maghrib_ditangguhkan BOOLEAN NOT NULL DEFAULT false,
    cuti_umum        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_pending   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_khas      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_khas    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS subuh_ditangguhkan   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS maghrib_ditangguhkan BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_schedule_date             ON schedule(date);
CREATE INDEX IF NOT EXISTS idx_schedule_subuh_ustaz_id   ON schedule(subuh_ustaz_id);
CREATE INDEX IF NOT EXISTS idx_schedule_maghrib_ustaz_id ON schedule(maghrib_ustaz_id);

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

-- ── infaq ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS infaq_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
    is_active     BOOLEAN NOT NULL DEFAULT false,
    completed_at  TIMESTAMPTZ,
    launch_date   DATE,
    online_total  NUMERIC(12,2),
    online_total_updated_at DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS launch_date DATE;
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS online_total NUMERIC(12,2);
ALTER TABLE infaq_projects ADD COLUMN IF NOT EXISTS online_total_updated_at DATE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_infaq_projects_one_active
    ON infaq_projects (is_active) WHERE is_active = true;

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

CREATE TABLE IF NOT EXISTS infaq_projek_kutipan (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES infaq_projects(id),
    tarikh     DATE NOT NULL,
    jumlah     NUMERIC(12,2) NOT NULL CHECK (jumlah > 0),
    keterangan TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- ── news ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_announcements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    heading    TEXT,
    body_text  TEXT,
    image_url  TEXT,   -- path in GitHub repo, e.g. /news/assets/xxx.jpg
    start_at   TIMESTAMP,
    end_at     TIMESTAMP,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT news_announcements_has_content CHECK (image_url IS NOT NULL OR body_text IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS news_ticker (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message    TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'khutbah')),
    prefix     TEXT,
    start_at   TIMESTAMP,
    end_at     TIMESTAMP,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO news_settings (key, value) VALUES
    ('default_image',          '/news/default.svg'),
    ('default_ticker_line',    'Selamat datang ke Masjid Al-Mukhlisin Taman Jaya 6'),
    ('khutbah_csv_url',        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQDFOdEOVKqjeS1mErtCrV-Z1-dvArp3wteWAEyRM6KKzXN90yggh0Bc7Nq3yhYKdAEo1NkAiV3lZGd/pub?gid=0&single=true&output=csv'),
    ('khutbah_last_title',     ''),
    ('khutbah_last_fetched_at', '')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_news_announcements_sort ON news_announcements(sort_order);
CREATE INDEX IF NOT EXISTS idx_news_ticker_sort         ON news_ticker(sort_order);

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

-- ── staff ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name                  TEXT NOT NULL,
    phone                      TEXT,
    email                      TEXT,
    pin_hash                   TEXT,
    device_session_token       TEXT,
    device_session_started_at  TIMESTAMPTZ,
    failed_pin_attempts        INTEGER NOT NULL DEFAULT 0,
    locked_until                TIMESTAMPTZ,
    enabled                     BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (email);

CREATE TABLE IF NOT EXISTS staff_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_activity_log_created_at ON staff_activity_log(created_at DESC);

-- ── khutbah ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS khutbah_weeks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    friday_date      DATE UNIQUE NOT NULL,
    source_url       TEXT NOT NULL,
    siri_text        TEXT NOT NULL,
    title            TEXT,
    date_text        TEXT,
    main_text        TEXT,
    hijri_part       TEXT,
    gregorian_part   TEXT,
    manual_override  BOOLEAN NOT NULL DEFAULT false,
    scrape_status    TEXT,
    scrape_error     TEXT,
    fetched_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS khutbah_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_khutbah_activity_log_created_at ON khutbah_activity_log(created_at DESC);

-- ── kalendar ──────────────────────────────────────────────────────────────────
-- No data table (events.json on GitHub stays source of truth) — audit log only.
CREATE TABLE IF NOT EXISTS calendar_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email  TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target_label TEXT,
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_activity_log_created_at ON calendar_activity_log(created_at DESC);

-- ── bootstrap first super_admin (run once, then delete/ignore) ───────────────
-- INSERT INTO admins (email, name, role, permissions) VALUES
--     ('your-email@gmail.com', 'Your Name', 'super_admin',
--      '{"kuliah": true, "infaq": true, "news": true, "staff": true, "khutbah": true, "kalendar": true}'::jsonb);
