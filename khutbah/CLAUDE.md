# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Mimbar Jumaat" — a Friday sermon (khutbah) title display screen for MAMTJ6. Shows the current sermon title, date, and theme/text, pulled live from a publicly-published Google Sheet (CSV export). Designed to be displayed on a screen/projector or embedded via Google Sites.

## Tech Stack

Same as the parent project: pure static HTML, no build tools. Each page is fully self-contained (inline `<style>` and `<script>`).

- Data source: `khutbah/data/khutbah.json` (published by `api/publish-khutbah.js`), polled every 60 seconds via `fetch`
- Font: Google Fonts "Poppins"
- Background/logo images served locally from `/media/` (`/media/img/`, `/media/logo-mamtj6/WEBP/`)

## Files

- `index.html` — **Current/primary display page** (as of 2026-09-28; promoted from
  `paparan-tajuk.html` so the official URL is the clean `/khutbah/`). Reads the
  published JSON at `khutbah/data/khutbah.json` (written by
  `api/publish-khutbah.js` via `admin/khutbah/`), polled every 60s. JSON has no
  CSV-quoting failure mode by construction.
- `paparan-tajuk.html` — Thin redirect shim to `/khutbah/` (JS
  `location.replace` + meta-refresh fallback). Kept only so existing bookmarks,
  the mosque screen, and the Google Sites embed keep working — repoint those to
  `/khutbah/` when convenient. No display code left in this file.
- `beta-paparan-tajuk.html` — Variant tuned for embedding inside a Google Sites iframe (`height: 100vh`/`100vw`, `overflow: hidden`, no scrollbars, no loading/error text states). Still on the old CSV feed; likely has the same unfixed CSV-quoting bug (not yet verified).
- `data/khutbah.json` — Published data (`{ current, history, updated_at }`), written by `api/publish-khutbah.js`. **Never hand-edit** — overwritten on every publish, same rule as kuliah's `jadual_lengkap_v2.json`.
- `google_app_script/` — RETIRED Apps Script automation (`gettajukkhutbah.gs`, `KhutbahLinkGenerator.gs`, `refresh.gs`). Replaced 2026-09-15 by `admin/khutbah/` + `api/publish-khutbah.js` (pure logic ported to `admin/khutbah/publish-khutbah-pure.js`). Kept in repo as history only — do not paste back into script.google.com. See "Apps Script Automation" below and `DEV_NOTES.md` for the old architecture/gotchas.

## Data Format

`index.html` (primary) fetches `khutbah/data/khutbah.json` (`{ current, history, updated_at }`,
written by `api/publish-khutbah.js`) and renders `current`:

- `current.siri_text` → sermon heading (`.title`)
- `current.date_text` → date (`.date`)
- `current.title || current.main_text` → big sermon text (`.main-text`)

`beta-paparan-tajuk.html` is frozen on the old feed: same published CSV, row index `1`
(second row after the header) — `rows[1][1]` → title, `rows[1][2]` → date, `rows[1][3]` → theme/text —
via the hardcoded `sheetURL` in the file's `<script>`. `index.html` has no sheet reference anymore
(switched to JSON 2026-09-15 on `paparan-tajuk.html`, promoted to `index.html` 2026-09-28).

## Apps Script Automation (`google_app_script/`)

Three scripts, sharing one Apps Script project's global scope (no per-file isolation — duplicate function names across files silently conflict), running against **two Google Sheet tabs**:

- **Tab 0, "tajuk khutbah"** (`LINK | Title | Date | Main Text`) — `extractKhutbahData()` in `gettajukkhutbah.gs` always targets `getSheets()[0]`, i.e. this tab. Reads the URL in A2, fetches that page, scrapes date → C2 and title → D2.
- **Tab 1, "link extractor"** (`KHUTBAH MINGGU INI | TARIKH | TAJUK KHUTBAH` — column B's header is stale, see below) — `generateKhutbahLink()` in `KhutbahLinkGenerator.gs` targets this tab by name. Computes the upcoming Friday, converts it to Hijri via `api.waktusolat.app` (zone `PHG03`), writes the resulting mufti.pahang.gov.my link to A2, and writes `MIMBAR JUMAAT SIRI {month} | {year}` to B2 (month/year taken from that Friday's date, not today's — deliberate, matters at month boundaries). Also appends a row (`Timestamp | Old Link | New Link | Siri`) to a **"Link Log"** sheet (auto-created on first run) every time it runs.

**"tajuk khutbah"!A2 is a live formula**, `='link extractor'!A2` — this is how tab 1's freshly-generated link reaches tab 0. Formula recalculation does *not* fire Sheets' `onEdit` event (only direct edits do), which is why `generateKhutbahLink()` calls `extractKhutbahData()` directly at the end rather than relying on the edit trigger to cascade. The edit trigger (`onEditTrigger`, installed by `createTrigger()`) instead exists for the separate manual workflow: when mufti.pahang.gov.my changes its URL format, the link is hand-corrected directly in "tajuk khutbah"!A2 — which **replaces the formula with a plain value** until it's manually re-entered.

Triggers (installed via the online Triggers panel, not all created by code in this repo): `onEditTrigger` on any edit (checks for A2 on "tajuk khutbah"), `generateKhutbahLink` weekly (Monday 9am, installed by `scheduleScript()`), and a standalone weekly trigger directly on `extractKhutbahData`. `refresh.gs`'s `onOpen()` adds a "Custom Menu" → "Run Script" item for manual runs; `onOpen2()` is dead code (not a recognized Apps Script simple-trigger name) and `runMyFunction()` is scratch/test code — neither is called by anything.

See `DEV_NOTES.md` for the fuller narrative (bugs found/fixed, why the code is split into 3 files, live-test results).

## Key Patterns

- **Auto font-sizing**: `.main-text` font size is adjusted based on text length (and, in the beta version, by shrinking the font in a loop until it fits its container) so long sermon titles don't overflow.
- **CSV parsing**: the legacy `index.html` once carried a quote-aware `parseCSVRow(line)` helper instead of a plain `row.split(",")` (Google Sheets' CSV export wraps any field containing a comma in double quotes — a naive `split(",")` truncates those fields at the embedded comma). That pre-promotion copy survives only in git history now; `beta-paparan-tajuk.html` still uses the naive split and has this bug.
- **Polling**: data is re-fetched every 60s; if the fetched row is identical to the last one (`lastFetchedData`), the DOM is left unchanged to avoid unnecessary re-renders/flicker.
- **Responsive**: `index.html` uses a fixed 1000px `.container` + JS `scaleToFit()` (see `developer.md` "The vh lesson"); `beta-paparan-tajuk.html` instead uses viewport-relative units (`vh`/`vw`/`clamp()`) throughout, so no separate mobile breakpoint is needed.
