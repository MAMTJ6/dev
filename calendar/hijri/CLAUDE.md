# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Malaysian Islamic Important Dates Calendar (Kalendar Tarikh Penting Islam Malaysia). A static web project displaying key Islamic dates for Malaysia with countdown timers, Hijri date conversion, and embeddable widgets. All content is in Malay (Bahasa Melayu).

## Tech Stack

- Vanilla HTML5, CSS3, JavaScript (ES6+) — no frameworks, no build tools, no npm
- Tailwind CSS via Play CDN (`https://cdn.tailwindcss.com`) with `darkMode: 'class'`
- Google Fonts: Inter (shadcn/ui-inspired typography)
- Data stored in `data/events.json` (single source of truth for all pages)
- External APIs: e-Solat JAKIM API (Hijri dates/prayer times), SIRIM MST widget (Malaysia Standard Time)
- Deployed via Vercel at `https://dev.mamtj6.com/calendar/hijri/` (GitHub Pages retired 2026-07-14)

## Development

No build, lint, or test commands — this is a pure static site. Open HTML files directly in a browser or serve with any static server. Changes to `data/events.json` are picked up by all pages on reload.

## File Structure

```
calendar/hijri/
  data/
    events.json           ← Data acara (single source of truth)
  tarikh-penting/
    index.html            ← Main calendar page (HTML + Tailwind CDN)
    app.js                ← JavaScript logic (theme, API, table rendering)
    style.css             ← Mobile-only CSS (table-to-card)
    info2.html            ← Alternative layout variant (inline JS/CSS)
  widgets/
    widgets.html          ← Embeddable countdown widget v1 (for iframe)
    widgets2.html         ← Embeddable countdown widget v2 (better mobile)
  hari-ini/
    index.html            ← MST time & current Hijri date widget
  ics/
    generate_ics.py       ← Python script to generate Hijri ICS calendar
    jakim_hijri.ics       ← Generated ICS file (committed, served statically)
    README.md             ← Subscription instructions for end users
  CLAUDE.md
  readme.md
```

## Architecture

```
data/events.json ──→ tarikh-penting/index.html + app.js + style.css  (main calendar)
                 ──→ tarikh-penting/info2.html    (alternative layout, inline JS/CSS)
                 ──→ widgets/widgets.html          (embeddable countdown v1)
                 ──→ widgets/widgets2.html         (embeddable countdown v2)

e-Solat API ──→ tarikh-penting/index.html, info2.html, hari-ini/index.html (current Hijri date)
SIRIM MST  ──→ hari-ini/index.html (live Malaysia time widget via iframe)

api.waktusolat.app ──→ ics/generate_ics.py ──→ ics/jakim_hijri.ics  (subscribable ICS calendar)
GitHub Actions (monthly cron) ──→ generate_ics.py ──→ commit jakim_hijri.ics
```

### tarikh-penting/ (main page — 3-file architecture)
- **index.html**: HTML structure with Tailwind CDN, dark mode toggle, responsive grid layout (sticky sidebar + table)
- **app.js**: All JavaScript logic — theme toggle, e-Solat API date fetching, event rendering, countdown calculations
- **style.css**: Mobile-only CSS for table-to-card transformation (`@media max-width: 767px`)

### Other pages (inline architecture)
- **tarikh-penting/info2.html**: Alternative calendar layout with all CSS and JS inline
- **widgets/widgets.html, widgets2.html**: Standalone countdown widgets for `<iframe>` embedding. Accept `?event=EVENTNAME` URL parameter
- **hari-ini/index.html**: Displays current MST time (SIRIM iframe) and Hijri date (e-Solat API). Standalone widget, does not use `events.json`

## Key Patterns

- **tarikh-penting/index.html uses separated files** (`app.js`, `style.css`); all other HTML files have inline CSS and JS
- **Dark mode**: `darkMode: 'class'` in Tailwind config, anti-flash script in `<head>`, localStorage persistence with OS preference fallback
- **Responsive layout**: Desktop uses `lg:grid lg:grid-cols-3` with sticky sidebar (upcoming event card on left, table on right). Below `lg` (1024px) everything stacks vertically. Below 768px, table rows transform into cards via `style.css`
- **Color scheme**: Zinc neutrals, emerald for upcoming/next event highlights, amber for countdown badges
- **Logos**: Two separate SVGs — `mamtj6-black_text.svg` (light mode) and `mamtj6-white.svg` (dark mode), toggled with `block dark:hidden` / `hidden dark:block`
- **Mobile breakpoint**: 767px in `style.css`. Desktop-first CSS with mobile overrides via `@media`
- **Date locale**: `ms-MY` for Malay formatting. Hijri month names are mapped from numeric codes (`"01"` → `"Muharam"`, etc.)
- **Date format**: Table shows `Hijri / Masihi (Hari)` e.g. `27 Rejab 1446 H / 17 Januari 2026 (Sabtu)`
- **Special events** (`Aidiladha`, `Aidilfitri`, `Ramadan`) are hardcoded in `app.js` and marked with `*` asterisk
- **Event status**: Events are classified as passed (opacity 0.5), upcoming, or next (emerald highlight). Countdown uses `Math.ceil` on day difference

### ics/ (ICS Calendar Generator)
- **generate_ics.py**: Python 3 script. Fetches full-year prayer time data (current + next year) from `api.waktusolat.app` for zone `WLY01`, then generates `jakim_hijri.ics` — a Hijri date calendar with one all-day event per day showing the Hijri date in Malay (e.g. `27 Rejab 1446H`).
- **jakim_hijri.ics**: The generated output. Committed to the repo and served statically so users can subscribe via Google Calendar URL.
- **Running locally**: Must run from the **repository root** (two levels above `ics/`), not from within `ics/`, because the output path is hardcoded as `calendar/hijri/ics/jakim_hijri.ics`. Prerequisite: `pip install requests`. Command: `python calendar/hijri/ics/generate_ics.py`.
- **Automation**: GitHub Actions runs the script on the 1st of every month and commits the updated `.ics` file. If the action fails with 403, enable "Read and write permissions" under *Settings > Actions > General > Workflow permissions*.
- **Hijri month names**: `HIJRI_MONTHS` dict in `generate_ics.py` maps `"01"`–`"12"` to Malay names (note: uses `Muharram`/`Ramadhan` spelling, differing slightly from `HIJRI_MONTHS` in the web pages which use `Muharam`/`Ramadan`).

## Annual Update Process

1. Edit `data/events.json` with new Gregorian dates, Hijri dates, and `lastUpdated` timestamp
2. Commit and push — Vercel deploys automatically
3. No code changes needed unless event names change or new events are added

## Important Considerations

- `tarikh-penting/index.html` uses external `app.js` and `style.css`; `info2.html` has everything inline — changes to shared logic must be applied to both
- The special events list (`['Aidiladha', 'Aidilfitri', 'Ramadan']`) is in `app.js` and duplicated in `info2.html`
- e-Solat API endpoint is hardcoded: `https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=today&zone=WLY01`
- Widget pages are designed for iframe embedding — keep them self-contained
- Tailwind CSS classes for table row highlights are applied via JavaScript (`app.js`), not in `style.css` — mobile overrides in `style.css` use `!important` to override them
