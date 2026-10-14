# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static website for Masjid Al-Mukhlisin Taman Jaya 6 (MAMTJ6) — a Malaysian mosque's digital presence. Contains multiple sub-projects: lecture schedule system, Islamic calendar, digital signage, and utility tools. All content is primarily in Malay (Bahasa Melayu). Hosted via Vercel at `dev.mamtj6.com`.

**`kuliah/` folder history:** as of 2026-07-14, `kuliah/admin/` and `kuliah/jadual/` are the Supabase-backed system (formerly at `kuliah3/`) — this is now the official lecture-schedule system. The older Google-Sheets-backed v15.4 system that used to live at `kuliah/jadual/` moved to `kuliah3/jadual/` (plus `kuliah3/kuliah(beta)/`), kept archived and fully working as a live fallback/reference. `kuliah/data/`, `kuliah/paparan/`, `kuliah/assets/`, `kuliah/gscript/` were untouched by that move — shared infrastructure, unmoved throughout. **As of 2026-07-19, `kuliah/admin/` moved again, to root `admin/`** (see `admin/CLAUDE.md`, `admin/plan.md`) — it's now a multi-module hub, not kuliah-specific. Old `/kuliah/admin/...` URLs redirect to `/admin/...` via zero-JS stubs left in place.

## Tech Stack

- Pure static HTML5, CSS3, Vanilla JavaScript (ES6+) — **no npm, no build tools, no frameworks**
- Tailwind CSS via Play CDN (`darkMode: 'class'`)
- Google Fonts: Inter
- External APIs: e-Solat JAKIM (Hijri dates, zone `WLY01`), SIRIM MST (Malaysia Standard Time)
- `admin/`: Supabase (PostgreSQL, Auth, Storage) — see `admin/CLAUDE.md`
- `kuliah/gscript/` (unmoved): Google Sheets as CMS → Google Apps Script syncs JSON to GitHub via API — independent pipeline, see Data Flow below
- Deployment: Vercel only (auto on push, `cleanUrls: true`, `trailingSlash: false` — see `vercel.json`). GitHub Pages was retired 2026-07-14 — no `CNAME` file, don't reintroduce Pages-specific assumptions (e.g. relying on the repo's default `github.io` URL, or a `gh-pages` branch).

## Development

No build, lint, or test commands. Serve locally with any static server:

```bash
python -m http.server
# Open http://localhost:8000
```

Files fetching JSON (`kuliah/jadual/`, `kuliah3/jadual/`, `calendar/`) require an HTTP server — `file://` won't work due to CORS. `admin/`'s Supabase auth and `/api/publish` cannot be exercised under this local method at all (documented limitation, see `admin/developer.md`).

## Architecture

```
index.html                          ← Hub/landing page (ticker, links to sub-projects)

admin/                               ← CMS: Google-OAuth admin dashboard (multi-module hub),
                                        see admin/CLAUDE.md — moved here from kuliah/admin/ on 2026-07-19
  kuliah/                            ← Module: lecture schedule CRUD (dashboard/ustaz)
  infaq/                             ← Module: donation/expense tracking, added 2026-07-19 —
    data/monthly.json, data/daily.json, data/perbelanjaan.json
                                        ← Published by api/publish-infaq.js, no public reader yet.
                                        Donation/expense rollups always computed, never typed in.
                                        Shapes mirror the real infaq.mamtj6.com reference site's
                                        own file structure

kuliah/                              ← Official lecture-schedule public surface (Supabase-backed)
  admin/                             ← 5 zero-JS redirect stubs → /admin/... (old URLs, pre-2026-07-19)
  jadual/                            ← Public schedule view (dual-view: desktop table + mobile cards)
  data/jadual_lengkap.json          ← OLD pipeline's data (Sheets-synced, unmoved — see Data Flow)
  data/jadual_lengkap_v2.json       ← THIS system's published data (Supabase → api/publish.js)
  paparan/                          ← Digital signage (index.html, routed by ?subuh/?maghrib/?subuh-esok/
                                        ?maghrib-esok query — old 4 filenames kept as redirect stubs for
                                        already-configured screens) — drives a physical screen at the mosque,
                                        reads jadual_lengkap_v2.json (Pipeline 2)
  gscript/                          ← Local mirror of the deployed Google Apps Script (Sheets→JSON, Drive→posters)

kuliah3/                             ← Archived v15.4 system (Sheets-backed), kept live as fallback
  jadual/                           ← Same schedule system that used to be at kuliah/jadual/
  kuliah(beta)/                     ← Beta mirror, own Apps Script config (see Sensitive Files)

calendar/hijri/
  data/events.json                  ← Islamic dates (single source of truth, manually updated yearly)
  tarikh-penting/                   ← Main calendar (3-file: index.html + app.js + style.css)
  widgets/                          ← Embeddable countdown widgets for iframe
  hari-ini/                         ← Current Hijri date & MST time widget

khutbah/                             ← Friday sermon (khutbah) title display, polls Google Sheet CSV
staff/                               ← Staff identity/login layer (new 2026-07-29) — PIN or Google
                                        login for a workforce distinct from admins; login only, no
                                        clock-in/geolocation/attendance yet. Managed from admin/staff/
csr/weather/                        ← Pahang weather-warning map + digital-signage display (MET/data.gov.my)
csr/calc/                           ← Calculator tool
web/asset/moving-text/              ← Scrolling text ticker
media/                              ← Images, logos (SVG variants: black/white for dark mode)
```

### Data Flow

**Two independent pipelines feed the lecture-schedule system — they are intentionally separate, do not merge them:**

```
Pipeline 1 (unmoved, pre-existing): Google Sheet → Google Apps Script → GitHub API push
                                       → kuliah/data/jadual_lengkap.json
                                       → read by kuliah3/jadual/ (archived system)

Pipeline 2 (Supabase-backed, official system): Admin edits in admin/dashboard.html
                                       → Supabase `schedule`/`ustaz` tables
                                       → click Terbitkan → POST /api/publish
                                       → api/publish.js reads Supabase, pushes to GitHub
                                       → kuliah/data/jadual_lengkap_v2.json
                                       → read by kuliah/jadual/ (official public view)
                                            and kuliah/paparan/ (digital signage — migrated from Pipeline 1)
```

```
Manual edit → calendar/hijri/data/events.json (updated annually with new Islamic dates)
```

**Never manually edit `jadual_lengkap.json` or `jadual_lengkap_v2.json`** — both are overwritten by their respective automated sync (Apps Script / `api/publish.js`). Use the Google Sheet or the `admin/` dashboard instead, matching whichever pipeline you're actually trying to change.

### Sub-Project Documentation

Each major sub-project has its own CLAUDE.md with detailed architecture:
- `admin/CLAUDE.md` — Official Supabase-backed admin CMS internals (moved from `kuliah/` 2026-07-19)
- `kuliah/CLAUDE.md` — Public schedule view + digital signage internals (jadual/, paparan/)
- `kuliah3/jadual/CLAUDE.md` — Archived v15.4 Sheets-backed system internals (dual-view, print, Apps Script)
- `calendar/hijri/CLAUDE.md` — Calendar system specifics
- `khutbah/CLAUDE.md` — Mimbar Jumaat sermon display specifics
- `staff/CLAUDE.md` — Staff login layer specifics (PIN/Google, session model, setup steps)
- `csr/weather/webpage-plan.md` — Weather-warning map + signage page specifics (no dedicated CLAUDE.md yet)

## Key Patterns

- **Changelog (enforced pre-commit):** `admin/changelog.json` is the single maintained changelog — one entry per user-visible change, Malay `ringkasan` first plus technical `detail`, rendered at `/admin/changelog.html` for all authenticated admins. Append the entry BEFORE committing, in the same commit as the change; never batch it "later". Root `CHANGELOG.md` is frozen history (see its header).

- **Cache-busting** on JSON fetches: `?v=${new Date().getTime()}`
- **Dark mode**: Tailwind `class` strategy, anti-flash `<script>` in `<head>`, localStorage with OS fallback
- **Responsive**: 768px breakpoint for desktop/mobile view switching
- **Date handling**: ISO 8601 (`YYYY-MM-DD`), locale `ms-MY`, timezone-safe parsing with `new Date(date + 'T00:00:00')`
- **Logos**: Separate SVGs toggled via `block dark:hidden` / `hidden dark:block`
- **Print**: A4 landscape, units converted to `pt`, `print-color-adjust: exact` for colors

## Sensitive Files

- `kuliah3/jadual/google-app-script/config.json` — Contains GitHub tokens and credentials (template/placeholder values as of last check, not confirmed live). **Never commit real values.**
- `kuliah3/kuliah(beta)/jadual/google-app-script/config.json` — **Contains what appears to be a live, real-format GitHub PAT, flagged unresolved across multiple sessions (see `kuliah/DEV_NOTES.MD`).** Moving this file's folder location does not remediate the exposure — the secret is already in git history regardless of current path. Recommend rotating/revoking it in GitHub settings and replacing the committed value with a placeholder.
- `admin/` (moved from `kuliah/admin/` 2026-07-19) has no committed config files with secrets — Supabase service-role key and GitHub token are Vercel environment variables, never in browser code or repo files. See `admin/database.md` for the full credentials/setup reference.
- `api/weather-warning.js` (`csr/weather/`) — MET Malaysia API token is a Vercel environment variable (`MET_TOKEN`), never in browser code or repo files. See `csr/weather/webpage-plan.md`'s v2 section.
- `api/staff-login.js` (`staff/`, `admin/staff/`) — `GOOGLE_CLIENT_ID` is a Vercel environment variable; not secret (Google Client IDs are meant to be public/client-side) but must exactly match the same value hand-pasted into `staff/script.js` (no build step to inject it). Staff never authenticate via Supabase Auth at all — see `staff/CLAUDE.md`/`admin/CLAUDE.md` before changing anything about this module's login flow, getting this wrong is a real confidentiality risk, not a style choice.
