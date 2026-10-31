# news/test — cycle-total dynamic duration test (Xibo)

Isolated folder to verify `XiboPageRendered` support before touching live `news/`.
Reads its own `fixture.json`, not `data/announcements.json`.

## Behavior

- Slideshow (`/news/test/`): plays ALL active slides 1..n in order with NO
  intermediate signal, then sends ONE signal at the end of the full cycle.
  Total = dynamic sum of active slide durations, recomputed at each cycle start.
- Single (`?type=` / `?ann=`): one slide, one signal (for one-widget-per-slide setups).

Durations are defined in `TEST_DURATIONS` in `test.js`: text 8s, image 12s, combo 15s.
Full fixture = 8+12+15 = 35s. Disable one fixture item and the next cycle total shrinks.

## URL modes

| URL | Behavior |
|---|---|
| `/news/test/` | full cycle: slides 1..n, ONE cycle signal at end (use ONE Xibo widget) |
| `/news/test/?type=text` | one text slide, signal after 8s |
| `/news/test/?type=image` | one image slide, signal after 12s |
| `/news/test/?type=combo` | one combo slide, signal after 15s |
| `/news/test/?ann=1` `?ann=2` `?ann=3` | pin one fixture item by order (production `?ann=N` pattern) |
| `&duration=N` | override every slide to N seconds, e.g. `?duration=5` makes full cycle 15s |

## Test in browser (no Xibo)

```bash
python -m http.server
# http://localhost:8000/news/test/
# http://localhost:8000/news/test/?type=text
# http://localhost:8000/news/test/?ann=2
```

The black HUD shows: type, slide i/n, per-slide duration, slide countdown,
cycle total + cycle remaining, Xibo status.
Outside Xibo: `not in Xibo — logged only`, signal is only a `console.log`.
Slideshow loops after a 1.5s pause so all types can be previewed. Single modes
stay on the slide after the signal.

## Test in Xibo (verify duration support)

1. Layout -> add ONE **Webpage** widget (for the cycle test):
   - `https://dev.mamtj6.com/news/test/`
2. Enable **Use Duration from Page** (or **Page Finish Signal**).
3. Set fallback duration `60s` (must be ABOVE the max dynamic total, since the
   total shrinks/grows with active slides).
4. Schedule to a test display and observe:
   - Supported: widget advances at ~total (e.g. ~35s with all 3 fixture slides).
   - Not supported: widget stays the full 60s fallback.
5. To prove the total is dynamic, disable one fixture item and confirm the next
   cycle is shorter (e.g. 8+15 = ~23s).
6. Version note: `XiboPageRendered()` is stable on v2/v3; keep player major
   version aligned with CMS (see `../xibo_open_source_signage_dynamic_duration_guide.md` §4).

Production will follow the same pattern with `.../news/`: one widget,
full cycle of active announcements, one cycle-end signal.

## Design notes

- Duration timer starts **after** `img.onload` for image/combo — avoids Xibo
  cutting while a poster is half-loaded.
- Active list + total are frozen per cycle; mid-cycle publishes apply on the
  next cycle (avoids cutting the current cycle short).
- `textContent` only, `object-fit: contain`, fade-over-top (`TEST_FADE_MS`
  in sync with `style.css`).
- `?duration=` is useful for fallback checks: `?duration=25` gives a 75s
  cycle, so a 60s fallback firing first proves the signal never arrived.
