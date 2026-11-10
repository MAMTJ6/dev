# Changelog

All notable changes to the weather pages (`csr/weather/` — interactive map
plus `paparan/` signage) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers below are assigned retroactively for this file — the project
previously used plain `v1`–`v8` labels (`webpage-plan.md`), which map to
`1.0.0`–`8.0.0` here. Technical detail lives in `webpage-plan.md`;
session notes in `DEV_NOTES.md`. View this file in the browser via
`?changelog` on the interactive page.

## [Unreleased]

### Added (redesign branch `redesign/weather-titisan-mobile`, mobile <768px only, desktop untouched)

- Titisan-style mobile shell: floating toolbar, status card with tier pill,
  bottom nav (Peta / Amaran / Tetapan / Info), Tetapan layers sheet
  (Perairan, Angin, Tema gelap), Info bottom sheet, Amaran floating popup
  hosting the real warning/forecast cards.
- Merged GPS + manual location chooser: geolocation matches the district
  in-page (state switches when needed, no zoom) with a pulsating dot;
  `?testgps=lat,lng` demo hook.
- "Hujan model" card (Anggaran): Open-Meteo 24h rain, hourly bars, 3-day
  rows; GloFAS river percentile via grid-snapped cell; wind compass block;
  tide highs/lows derived from the marine sea-level curve. District-only,
  30-min cache, degrades to one muted line, never blocks MET cards.

### Fixed

- Mobile backdrop shipped without `hidden` (permanent dim layer).
- Mobile bottom sheet caused double scroll (inner scrollbox neutralised).

- Statewide wash missed for bulletins phrased "states of X" (plural English):
  Terengganu now highlights correctly. Parser checks both `text_en` and
  `text_bm`, and accepts the "W.P. " prefix (W.P. Labuan now washes too).
- "W.P. Labuan" (and "W.P. Kuala Lumpur") now bolds fully in the nationwide
  summary bar — previously only "Labuan" was bold.

## [9.0.0] - 2026-09-02

### Added

- Desktop F11 fullscreen scales all text/cards up (root font-size 140%).
- `?debugsize=1` viewport readout (listed in `?debug`).

### Changed

- `#side-column` shrinks to fit instead of scrolling (desktop + mobile;
  mobile keeps full width via iterative widen-then-scale).
- District labels restyled to outlined text; nationwide zoomed-in labels show
  two lines (District + smaller state name).
- `boldStateNames()` no longer bolds state names inside district lists.

## [8.1.0] - 2026-08-27

### Added

- Mobile (<768px) bottom-sheet layout with pull tab; full-width map.
- Per-state `mobile` zoom/center fields in `states.json` (placeholders).
- Repo-root `.vscode/settings.json`: JSON format-on-save off.

### Changed

- Nationwide defaults folded into the `malaysia` states.json entry
  (parallel constants deleted); all 16 states hand-tuned with real
  center/zoom values.
- Times render as AM/PM (Malay month/day names kept).
- Selected district renders a yellow halo instead of a blue border override.
- `?district=` stays synced in the URL; picking a district no longer moves
  the map.
- Side column widened 400px → 440px; forecast card restacked to two rows.
- Custom 0.2-step scroll zoom (exact hand-tuned zooms untouched).
- State-boundary outline thins automatically at low zoom.
- CARTO API key wired on both pages (vector-basemap migration parked).

### Fixed

- Card spacing bug (mismatched closing tag) and forecast icon sizing.
- Theme-toggle basemap misalignment fixed for real (layer recreate).

### Removed

- Dead legend rows; stale nationwide special-case branches.

## [8.0.0] - 2026-08-26

### Added

- Zoom-gated nationwide labels: none when zoomed out (hover/tap shows the
  state name); permanent "District, State" labels past zoom 8.63.
  Default nationwide view fixed at zoom 6.4.
- Combined multi-state bulletins render one row per numbered item, each with
  its own correct expiry (matches MET's printed poster).

### Changed

- State wash renders solid, same as district hits (washed-out look removed).
- Header card widened for long state names.

### Fixed

- Bare mid-list states (e.g. Melaka) now wash via the bulleted-state rule.
- Duplicate bulletin rows no longer show a misleading "+N lagi" badge or a
  neighbouring item's expiry.
- "Tropical Storm Advisory" distance mentions no longer wash whole states
  (fallback requires "state(s) of / negeri" phrasing).

### Removed

- Marine notice line; always-left side panel (Sepang/Sabah flip deleted).

## [7.0.0] - 2026-08-24

### Changed

- State outlines sourced from `malaysia.state.geojson` (Turf.js removed) —
  clean Terengganu/Perak seam.

## [6.1.0] - 2026-08-22

### Added

- Nationwide summary as a collapsible full-width bottom bar, showing MET's
  own bulletin wording with bold state names; marine-only bulletins excluded.

## [6.0.0] - 2026-08-20

### Added

- Multi-state support: `?state=` / `?district=` for all 16 states; nationwide
  default fetches once unfiltered and parses per-state in memory.
- Full-viewport responsive map with floating Tailwind panels and label-free
  CARTO basemap; forecast follows the focused district; rain card hides
  when empty.
- Sabah/Sarawak division-grouped bulletin parsing
  ("State: Division (districts), ...").
- `?raw` debug overlay on the interactive page.

## [5.1.0] - 2026-08-18

### Added (`paparan/` only)

- New thunderstorm Watch tier; marine exclusion hardened (heading match,
  runs before district matching); defensive continuous-rain catch on the
  free endpoint (MET token stays the primary rain source).

## [5.0.0] - 2026-08-10

### Changed (`paparan/` visual redesign)

- Fixed 1920×1080 scaled canvas, dark-default theme, Archivo + Inter, MET's
  own severity palette, district name pills, floating legend, per-tier
  warning cards with pulsing Bahaya glow.

## [4.0.0] - 2026-07-19

### Added

- New non-interactive `paparan/` signage page (Temerloh forecast + two fixed
  warning cards + nightly reload).
- `weather-core.js` extracted as the single shared fetch/parse/severity
  module for both pages.

### Changed

- Severity-tier colouring: Waspada < Amaran < Buruk < Bahaya, highest-wins
  per district, state wash with district tiers on top.

## [2.0.0] - 2026-07-18

### Added

- `/api/weather-warning` Vercel proxy (MET token server-side) with SEKSYEN
  parser: per-section tiers and termination-section exclusion.

## [1.0.0] - 2026-07-18

### Added

- Interactive Pahang district map with warning banner, dropdown, legend,
  3-minute polling, `?testWarning=` fixtures and marine-scope exclusion.
