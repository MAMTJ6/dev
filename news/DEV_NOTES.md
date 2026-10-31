the prompt (DO NOT DELETE)
> Check the Project Knowledge and the current chat for context. This conversation is ending soon. update the artifact news/DEV_NOTES.md (create if not available yet) with a detailed note to your next window self - not just facts but the vibe, our dynamic, the energy of this conversation. What would the next you need to immediately get back into this exact headspace? Include unique discoveries, current mood, and anything that'll help the next you instantly sync to our frequency. Also take note all of the bug found and fixed and what did you learn from it to make sure it dont happend again in the future. focus on news folder and its subfolder only
> also update the related file like news/CLAUDE.md, news/developer.md, news/developer.md and news/README.md database.md if necessary, create if not available yet

---

# DEV_NOTES — news/ (Paparan Pengumuman)

Session memo for the `news/` announcement display. Read `news/CLAUDE.md` for
the architecture reference; this file is the session-to-session context.

## Session 5 — 2026-10-31 (Xibo dynamic-duration experiment: built `news/test/`, pushed it, then proved dynamic timing is impossible on CMS 1.8.13)

### What happened, in order

1. User pasted `news/xibo_open_source_signage_dynamic_duration_guide.md`
   (a guide doc, still untracked in git as of this memo) and asked for a
   test news page with dynamic duration, suggesting `news/test/`.
2. Two Plan-mode rounds: first agreed per-type durations (text 8s / image
   12s / combo 15s); second pivoted on the user's correction — Xibo was
   showing ONE duration for the whole page (the sum). Agreed: slideshow
   plays all active slides, ONE signal at cycle end, total = dynamic sum
   of active slides.
3. Built `news/test/` (4 files, all isolated from live `news/`):
   `index.html` (+ black HUD: type, slide i/n, per-slide countdown, cycle
   total + cycle remaining, Xibo status), `test.js` (copy of
   `news/script.js` logic + `getDurationForItem()` + `getCycleTotal()` +
   `notifyXibo()`; cycle list+total frozen per cycle, mid-cycle publishes
   apply next cycle), `fixture.json` (3 always-active items, one per kind),
   `README.md` (browser + Xibo test steps).
4. Verified headlessly (repo's `vm` + DOM-stub pattern): durations
   8000/12000/15000, `?ann=2` pins single image mode, `?duration=1`
   3-slide cycle totals 3000ms with exactly ONE `XiboPageRendered()` at
   cycle end. Committed `dc31a71`, pushed to `origin/main` (Vercel
   auto-deploys `dev.mamtj6.com`).
5. User's Xibo screenshots showed the Webpage widget form has NO "Use
   Duration from Page" option — only Link/Name/"Set a duration?"/"Open
   Natively". Plus the "1 minute" default. Researched Xibo docs + community:
   page-driven duration was an unimplemented 2018 feature request; the
   supported dynamic mechanism is the `xiboIC` interactive-control library
   (v3+ only: `setWidgetDuration`/`expireNow` via player localhost:9696).
6. User pasted CMS About page: **1.8.13 (2018)**. Verdict delivered:
   dynamic duration is impossible on this stack — the CMS number is the
   final word. Recommended fixed durations: 3 widgets at 8/12/15s, or 1
   widget at 35s. Explained the xiboIC-on-v3+ path for later, and how to
   find versions (login footer / Administration → About / Displays page).
7. User: "so no option for dynamic now" — confirmed: dynamic *content*,
   fixed *timing*. Wrap-up requested.

### The dynamic — read this to re-sync

- **Plan-mode vs Build-mode boundaries held the whole session.**
   Discussion-only rounds produced the per-type-then-cycle-total design
   before any file was written; user explicitly released each gate
   ("ok test per type (a)", "sum by the total active slide", "go").
   Keep respecting the "explain-only, don't touch code" gear from
   session 2 — it was invoked explicitly twice here via Plan mode.
- **User communicates via screenshots as ground truth, again.**
   The Xibo widget-form screenshots answered in one glance what text
   couldn't (no duration-from-page option exists). Same lesson as every
   prior session: treat their screenshots as the spec.
- **Language: user asked for English-only chat this session**
   ("chat with me in english only") — prior sessions were Malay display
   text + English dev discussion. Default to English in chat unless told
   otherwise; repo content itself stays Malay.
- Mood: investigative then accepting — the dynamic-duration hope deflated
   on the 1.8.13 fact, no frustration, closed cleanly with wrap-up.

### Bugs found & fixed (and the lessons)

**BUG 1 (mine, PowerShell) — `&&` chaining in the `shell` tool.**
`node --check ... && echo ...` fails: the tool runs PowerShell, where
`&&` is not a statement separator. *Lesson:* **never `&&` in `shell`
commands — use `;` and check `$LASTEXITCODE`.**
**BUG 2 (mine, quoting) — `node -e` with nested quotes under PowerShell**
broke with `Invalid or unexpected token`. *Fix that stuck:* write the
check to a temp file (`C:\...\Temp\opencode\*.js`) and run it — also
avoids re-quoting on every iteration. *Lesson:* **one-off node probes go
in a temp script file, not `-e`, on this Windows/PowerShell setup.**
**BUG 3 (process hygiene) — a 12s `setTimeout` in the check script kept
node alive past the assertions**, making output look delayed. Harmless
here, but unref/clear timers in throwaway harnesses. *Lesson:* same as
any kiosk timer: know what keeps your process alive.
**BUG 4 (env) — no git identity configured** (`user.name`/`user.email`
both empty); commit failed until set repo-local to match prior history
(`mamtj6dev` / `mamtj6.dev@gmail.com`). *Lesson:* check identity before
committing in a fresh environment.

### Open threads (owners)

- **User to test on Xibo** with fixed durations (3 widgets 8/12/15 or 1
  widget 35s at `https://dev.mamtj6.com/news/test/`) — result not yet
  reported as of this memo.
- **`news/xibo_open_source_signage_dynamic_duration_guide.md` is
  untracked** — deliberately left out of commit `dc31a71`. Commit it if
  the user wants it kept in history.
- **xiboIC dynamic path needs CMS/player v3+ upgrade** (backup, Docker
  deploy, per-player verification). `getCycleTotal()` in `news/test/`
  is already the number that would feed `setWidgetDuration()`.
- Carried over, still open: default.svg's dropped Arabic greeting
  (intentional? — session 4), Vercel edge-latency vs hard-refresh
  hypothesis (unconfirmed), ticker `TICKER_LINE_MAX` literal duplication.
- No `admin/changelog.json` entry for `news/test/` — dev-only scaffold,
  not a user-visible change, per the repo's changelog rule.

### Current state at session end (session 5)

Live `news/` untouched — all work is in new `news/test/`, committed and
pushed (`dc31a71`), awaiting user's Xibo test with fixed durations.
Standing fact for this folder going forward: **CMS 1.8.13 cannot do
page-driven duration; timing is always the CMS-side fixed number.**

## Session 4 — 2026-07-29, later the same day (pure Q&A, no code — the display's own refresh mechanism, why hard-refresh sometimes needs a few tries, and a "what is a dynamic site" detour)

### What happened, in order

No files touched in this folder at all this session — a chain of "just answer"
questions, each building on the last, with a natural off-ramp at the end.

1. "What makes the news page update the content automatically?" — answered by
   pointing at the real mechanism: one 60s timer in `initNewsDisplay()`
   (`news/script.js`) that calls `refreshData()` (silent background fetch,
   keeps last-known-good data on failure) then `reevaluate()` every tick.
2. "Can reduce the capping updates to 5 minutes?" — genuinely ambiguous (the
   phrase "capping" echoed my own earlier description of the OLD, already-
   removed 10-minute `<meta refresh>` mechanism from session 2's Bug 5, not
   the CURRENT 60-second interval, which is already faster than 5 minutes).
   I asked a clarifying question via `AskUserQuestion` rather than guess which
   direction they meant; the user rejected that tool call outright and asked a
   different, more concrete question instead — see below.
3. **The real question underneath:** "why if i hard refresh ctrl f5, the
   content is not updating? it takes several hard refresh to update." Traced
   through the actual mechanics: the JSON fetch already has a `?v=timestamp`
   cache-buster AND `vercel.json`'s `Cache-Control: no-store` on
   `/news/data/(.*)` — both browser-cache and CDN-cache are already defeated
   for that specific request, so this isn't a caching bug in this folder's own
   code. Landed on the most likely explanation instead: **Vercel's own
   deployment pipeline** — Terbitkan → GitHub commit → brand-new Vercel
   build+deploy, and a fresh deployment needs a short build+global-edge-
   propagation window before every edge location is serving it; a hard
   refresh immediately after Terbitkan can land on a not-yet-updated edge
   node, and repeated refreshes have a chance of hitting a different,
   already-updated one. **This is a hypothesis, not independently confirmed**
   — I suggested checking the Vercel dashboard's Deployments tab timestamp
   against the refresh attempts next time to actually verify it, but that
   check hasn't happened yet as of this note.
4. "So the page is not dynamic?" → "what is dynamic site" — two follow-up
   conceptual questions, answered by contrasting this repo's actual static-
   site-plus-client-JS architecture (files on a CDN, "publishing" = a new git
   commit + redeploy, no live server-side query per request) against what a
   true dynamic site would do instead (query a database live, per request, no
   rebuild/redeploy step at all) — tied back to `news/`'s own Terbitkan flow
   as the concrete example throughout, not left as abstract theory.
5. User started to react, then said "nvm" — the thread ended there, no
   further action requested.

### The dynamic — read this to re-sync

- **This is the same "just answer" gear documented in sessions 1-3, but
  worth noting a new wrinkle: an ambiguous question is a real signal to
  clarify, not to guess-and-implement — and the user is comfortable flatly
  rejecting a clarifying question and just re-asking more concretely
  instead.** Don't take that rejection as friction; it resolved into a
  better, more answerable question two turns later.
- **Pure conceptual/educational Q&A ("what is a dynamic site") is a
  legitimate mode for this user, not a detour to rush past.** They're
  building a real mental model of how their own site works, one concrete
  question at a time, and each answer landed better by tying straight back
  to a mechanism already in `news/`'s own code (Terbitkan, the JSON fetch)
  rather than staying abstract.
- Mood: curious, low-stakes, comfortable trailing off once satisfied ("ok
  nvm") — no pressure to force the "reduce to 5 minutes" question to a
  concrete outcome once the real underlying confusion (why hard-refresh
  seems flaky) was actually resolved.

### Bugs found & fixed (and the lessons)

No code bugs this session — pure explanation. One **flagged-but-unconfirmed
hypothesis worth carrying forward**: the "several hard refreshes needed
after Terbitkan" symptom is most likely Vercel build+edge-propagation
latency, NOT a caching bug in this folder's fetch logic (which is already
correctly cache-busted + `no-store`). *Lesson: before proposing a code fix
for a "stale content" symptom, first rule out deployment-pipeline latency —
not everything that looks like a caching bug is one, especially on a repo
where "publish" always means "new deployment," never a live query.* If this
comes up again, the next step is a real timing check (Vercel dashboard
deploy-ready timestamp vs. refresh attempts), not a code change — nothing in
`news/`'s own fetch/cache logic needs touching based on what's known so far.

### Addendum, same session — a real bug this time, found from a screenshot pair

Right after the Q&A above, the user opened `news/index.html` in the IDE and sent two screenshots of the default "Selamat Datang" slide side by side: on their own machine the Arabic line (`أَهْلًا وَسَهْلًا`) renders correctly (joined cursive script), but on the actual Xibo screen it renders as disconnected/broken individual letterforms. Same shape of question as the `:has()` bug earlier in this conversation (see `kuliah/DEV_NOTES.MD` Session 2) — "works on my machine, broken on the actual signage hardware" — but a completely different root cause and fix.

**BUG — `default.svg`'s Arabic text depended on OS font-substitution, which isn't guaranteed consistent across machines.** The `<text>` element's `font-family="Georgia, 'Times New Roman', serif"` has no real Arabic shaping in either font — the browser silently falls back to whatever the OS substitutes for the Arabic Unicode range when none of the listed fonts cover it, and that substitution differed between the user's own PC (landed on something with full Arabic shaping) and the Xibo player's WebView2 environment (landed on something without it, producing isolated/unjoined letterforms — the classic symptom of missing complex-script shaping, not a missing-glyph tofu-box problem). A second wrinkle made the obvious fix (add a Google Fonts `<link>` to `index.html`) a dead end: `default.svg` is loaded via a plain `<img src>` (`script.js`), and an SVG used as an image is sandboxed from fetching any external resource, stylesheet included — a page-level web font can never reach text inside it.

*My fix (superseded within the same session, see below):* fetched a subsetted WOFF2 of Scheherazade New Bold from Google Fonts (using its `text=` param to subset down to just the ~10 characters this slide actually uses — 5.7KB raw, ~7.7KB as base64), and embedded it directly inside `default.svg` as a base64 `@font-face` in a `<style><![CDATA[...]]></style>` block. **The CDATA wrapper is load-bearing, not decorative** — SVG is strict XML, and a raw `<img>` mentioned in a plain-text comment inside an un-wrapped `<style>` broke XML parsing entirely (caught immediately via `python -m xml.dom.minidom`, before ever showing the user a broken file). Verified two ways before calling it done: (1) `python -m xml.dom.minidom` confirms the file is still valid XML with all 5 `<text>` elements intact, (2) `fontTools` confirms the actual downloaded font (the plain-TTF variant, since the WOFF2 needs a `brotli` module this environment doesn't have) contains every codepoint the Arabic line uses plus both `GSUB` (contextual joining/ligatures) and `GPOS` (diacritic mark positioning) tables — the two OpenType feature sets Arabic shaping actually depends on.

**Then the user said "the font, i dont like it. now i custom it manually to new design" and replaced the whole file themselves — an Adobe Illustrator export, not a hand-edit of my version.** Re-read and verified rather than assumed: valid XML, zero Arabic characters anywhere in the file (the "Ahlan wa Sahlan" line is gone from this design entirely — flagged to the user as possibly unintentional, not yet confirmed either way), and **all visible text is now pre-outlined vector `<path>` shapes** (Illustrator's "Create Outlines"), not live `<text>` needing any font at all — a leftover hidden `<g class="st11" style="display:none">` layer still has the original live-text+`Cinzel`-font version, Illustrator's own export artifact, never actually rendered. **This is structurally a more bulletproof fix than mine** — it needs zero font/shaping support from the renderer, full stop, rather than depending on WOFF2+CDATA support (both very safe bets, but "safe bet" is still weaker than "not applicable at all"). My embedded-font work is now dead code from the user's perspective, superseded, not merged with theirs.

*Lesson:* **any script that needs real shaping (Arabic, and any similarly complex script) rendered inside an `<img>`-loaded SVG must either embed its own font (my approach) or avoid live text entirely via outlined vector paths (the user's approach, and the one that actually shipped)** — never rely on system font-fallback, which is explicitly NOT guaranteed consistent across the machine that's easy to test on and the actual target hardware. This is the second time this exact conversation surfaced a "looks fine in a normal browser, silently breaks only on the real Xibo/WebView2 box" bug class (see the `:has()` fix) — worth treating "have you checked this on the actual signage hardware, not just a browser" as a standing question for any future visual change to `news/` or `kuliah/paparan/`. **Separately: when a user says they've "manually customized" a file, always re-read the actual current file state rather than assuming your last-written version is still there or was merged with theirs** — same standing rule as `admin/DEV_NOTES.MD`'s "co-edits files in real time" pattern, now confirmed in `news/` too.

### Current state at session end (session 4)

`news/default.svg` is now the user's own Illustrator-exported redesign — vector-outlined text throughout, no live `<text>`/font dependency for anything visible, no Arabic line at all (dropped in the redesign, not yet confirmed intentional). My earlier embedded-WOFF2-font version of this file is superseded, not merged — the user's file replaced it wholesale. Verified: valid XML, zero Arabic codepoints in the file. **Not yet confirmed working on the real Xibo screen either way** — same "written, not yet exercised on the actual hardware" caveat as everything else in this file until someone checks the physical display. **If picking this up next: confirm with the user whether the Arabic greeting is meant to come back in some form, or if the redesign deliberately dropped it.**

Nothing else in `news/` changed. The auto-refresh mechanism (60s silent
`refreshData()`+`reevaluate()`, see session 2) is unchanged and working as
designed. The "several hard refreshes" symptom remains unconfirmed as
deployment latency rather than something else — worth an actual timing
check next time someone's testing right after a Terbitkan click, before
assuming it's settled either way.

## Session 3 — 2026-07-29 (a small, focused tuning task — character limits on
the two `admin/news/` CMS forms — that turned into a live lesson about
guessing thresholds vs. measuring real content)

### What happened, in order

Much smaller in scope than sessions 1-2, no new files, no new schema, no new
architecture — just tightening two existing text fields in `admin/news/`.
But the shape of the conversation is worth remembering on its own:

1. User floated a hypothetical: "what if I sent the limit for
   `pengumuman.html` (180 chars) and `teks-berjalan.html` (50 chars), said
   that limitation is to make the text show properly on the Xibo display" —
   phrased as a proposal to gut-check, not yet a "do it."
2. I pushed back with a real distinction instead of just agreeing: the
   announcement box (`pengumuman.html`) is a fixed-size area with no
   scroll, so a length cap is a genuine overflow guard — but the ticker is
   a marquee that scrolls continuously, so a hard character cap there
   sounded more like a *pacing* choice dressed up as a display-fitting one.
   Asked which it actually was.
3. User corrected me with a concrete fact I had no way to know without
   asking: **some ticker slides had visibly had the text moving upward** —
   i.e. a real observed layout bug (long lines wrapping to a second row and
   pushing the ticker bar vertically), not marquee-scroll pacing at all.
   This reframed 50 chars as a bug mitigation with a real prior incident
   behind it, not a guess.
4. Implemented on "ok, proceed": `maxlength` + save-time validation on both
   pages, with the label/error text stating the *real* reason in each case
   (overflow for pengumuman, vertical-wrap for the ticker) — not a vague
   "for the display."
5. User then asked for a live remaining-character counter, visible once a
   field is ~80% of its cap. Built as a shared `attachCharCounter()` helper
   in `news-common.js` (both pages load this file) rather than duplicating
   it — see Unique Discoveries below for why it returns its update function.
6. **The pivotal moment:** user pasted 3 REAL ticker lines already in
   informal use — a Tahlil announcement, the standard welcome line, a
   phone-silent reminder — and asked me to count their characters. I ran
   them through node: **70, 67, and 72 characters.** All three exceeded the
   50-char cap we had *just shipped, that same session*, on the very first
   real content anyone actually checked it against.
7. Iterative correction, in real time: bumped 50→70 (fits 2 of 3, the third
   at 72 still 2 over) → bumped again 70→74 (fits all 3). Each bump touched
   the same 4 spots per file pair: `maxlength` + label text in the `.html`,
   validation threshold + counter threshold in the `.js` — done twice in
   one sitting, `replace_all` covering most of it but the differently-worded
   prefix-vs-message validation strings needing a manual second edit each
   time (they share a number, not a message template).

### The dynamic — read this to re-sync

- **Same brisk, capability-question cadence as session 1's "can it
  also...?" loop** ("what if I sent the limit...", "so maybe up the ticker
  limit to 70?", "ok bump to 74") — but this time aimed at *tuning a number
  on a feature that shipped minutes earlier*, using real content as the
  measuring stick, not requesting a new capability.
- **A terse justification can be hiding a specific, real failure mode —
  ask what it actually looks like before agreeing OR pushing back.** My
  first response distinguished "genuine overflow guard" from "pacing
  dressed up as fitting" reasonably, but I was still guessing between two
  plausible stories. The user's one-line reply ("text moving up") resolved
  it instantly and concretely. **Lesson generalizes from BUG 3/4 in session
  2 (screenshots are ground truth) to justifications too: when someone
  states a reason for a constraint, especially tied to real hardware, a
  quick "what does that look like / what breaks" question (or, here, just
  waiting for the natural follow-up) beats reasoning it out abstractly.**
- **This user is comfortable deciding the final number themselves once
  shown the data** — my job in step 6-7 was compute-and-present the
  character counts, theirs was to pick 70, then 74. Don't pre-empt that by
  suggesting a "safe round number" before they've seen the actual
  measurements against real content.
- Mood: efficient, low-friction, iterative — one-line asks, immediate
  small course-corrections, zero friction about redoing the same 4-6 edit
  sites twice in a row. No frustration at the two-bump correction; if
  anything the second bump ("ok bump to 74") reads like a fully expected
  next step once the first number visibly didn't fit real content.

### Bugs found & fixed (and the lessons)

**BUG 1 (not a code bug — a chosen-number bug, corrected on first contact
with real content).** The ticker's initial 50-char cap was picked from a
plausible-sounding heuristic ("should look fine on a ticker line") before
anyone measured a single real ticker line against it. The very first 3 real
examples brought in — content already in informal circulation, not
hypothetical — failed the cap (70/67/72 vs. 50), forcing two sequential
bumps in the same sitting (50→70→74).
*Lesson:* **when a length/size constraint is justified by a real display
constraint, get (or go count) actual current/real content BEFORE picking
the number, not after shipping it.** A constraint that immediately rejects
existing legitimate content is itself the signal that the number was
guessed rather than measured — don't wait for the user to be the one who
notices this; ask "do you have a real example I can measure?" up front
next time a similar length cap comes up anywhere in `admin/`.

**Not-a-bug, flagged proactively — the ticker's char limit is now a
hardcoded literal in ~8 separate spots, no single source of truth.**
`teks-berjalan.html` has `maxlength="74"` and "maks. 74 aksara" on BOTH the
message input and the prefix input (4 occurrences); `teks-berjalan.js` has
`length > 74` in two separate validation checks plus `attachCharCounter(...,
74)` twice (4 more). Two live bumps already happened in one sitting, each
needing a `replace_all` pass plus manual touch-up on the spots whose
surrounding text didn't match the pattern exactly (the prefix-vs-message
error strings). Nothing broke this time, but **the next person who bumps
this number again has to grep both files for the literal old number — there
is no `TICKER_LINE_MAX` constant to change in one place.** Not fixed this
session (pure same-day tuning, not the moment to also refactor) — worth
doing the next time either file is opened for an unrelated reason: a single
exported constant in `teks-berjalan.js`, interpolated into the label text
and read by `attachCharCounter()`/the validation checks, removes this risk
permanently.

**Open item, NOT yet checked the same way — `pengumuman.html`'s 180-char
limit has never been measured against a real `body_text` example**, unlike
the ticker's number, which got corrected the moment real data arrived. Same
lesson as BUG 1 above, just not yet applied to this sibling field — next
time someone's touching `pengumuman.html`, pull a few real announcement
bodies and sanity-check 180 before trusting it as final.

### Unique discoveries / decisions that aren't obvious from the code

- **`attachCharCounter(inputId, counterId, limit, thresholdRatio=0.8)`**
  (`admin/news/news-common.js`) is a small shared utility, deliberately
  returning its own `update` function rather than being fire-and-forget:
  `openAddModal()`/`openEditModal()` on both pages set `.value` on the
  input programmatically when populating the edit form, and a scripted
  assignment does **not** fire the `'input'` event the counter listens on
  — so both modal-open functions call the returned `update()` explicitly
  right after setting the value, or the counter would show stale (or no)
  state until the admin's next keystroke. **This is the pattern for any
  future "counter/note tied to a text field's current value" anywhere in
  `admin/`** — wire the live listener AND expose a manual re-run for
  programmatic value changes, don't assume `'input'` covers every path
  that sets `.value`.
- The two fields' limits protect genuinely different failure modes even
  though both are framed as "Xibo display" constraints: `pengumuman`'s 180
  chars guards against text overflowing a fixed-size box with no scroll;
  the ticker's (now 74) chars guards against long lines wrapping to a
  second row and moving the whole ticker bar vertically — a real,
  previously-unlogged production bug, not a marquee-pacing preference.
  Worth keeping these two justifications straight if either number is
  revisited again — they are not interchangeable reasoning.
- None of this touched the Supabase schema — `news_announcements.body_text`
  and `news_ticker.message`/`.prefix` are still unbounded `text` columns
  server-side (see `admin/CLAUDE.md`'s Supabase Schema section). Every cap
  added this session is a client-side-only guard, matching how every other
  soft validation in these two pages already works (`pengumuman.js`'s
  title-required / image-or-text-required checks are the same shape) — a
  hand-edit via the GitHub web UI, or the API bypassing the CMS entirely,
  is not stopped by anything added this session.

### Current state at session end (session 3)

`pengumuman.html`'s `#edit-text` textarea: `maxlength="180"`, a counter
that appears once length ≥144 (80% of 180), and a matching save-time toast
check in `pengumuman.js`. `teks-berjalan.html`'s `#edit-message` and
`#edit-prefix` inputs: both `maxlength="74"`, counters appearing ≥~59
chars, and matching save-time checks in `teks-berjalan.js` for both fields.
No schema change, no `database.md` update needed (see above — this is a
UI-only guard). Nothing else in `news/` itself (the public display page)
changed at all this session — everything here lives entirely in
`admin/news/`.

## Session 2 — 2026-07-28 (the CMS from session 1's deferred item got built in one pass, then a full week-one support/iteration cycle happened in the same sitting)

### What happened, in order

Two very different halves. **First half: a big pre-planned build, executed
mechanically.** A pre-written plan (`news/newplan.md`) for `admin/news/` +
`api/publish-news.js` — session 1's explicitly-deferred item — was
implemented in full, in one pass, no plan-mode cycle (the plan already
existed, so it was straight to execution). See `admin/DEV_NOTES.MD`
Session 15 for that build log in detail, since almost none of the new
code lives in this folder — this folder only gained a real writer for
`data/announcements.json`/`data/moving-text.json` (previously hand-edited/
Apps-Script-fed) and lost `moving-text/code.gs` (retired, kept for
history, not deleted).

**Second half: everything a module's real first week looks like, compressed
into one sitting.** Once the build was done, the conversation shifted into
a long guided-setup-and-support cycle with a user who needed much more
elementary hand-holding than session 1's user (exact click-by-click Vercel
navigation, a literal PowerShell command to generate a secret, confusion
about which field to fill in and why) — then, once things were running,
a string of real small feature requests and real bug reports arrived, in
this order: quick-link buttons to the published output → clarifying
"permanent line" vs. "empty-ticker fallback" semantics (pure explanation,
no code) → a feasibility Q&A on time-of-day scheduling (explicitly
"answer only, don't touch code") → conceptual Q&A on what the cron is even
for → "ok proceed, it is worth" → full day+hour+minute scheduling built →
**two separate user-reported CSS bugs from screenshots** → a "why doesn't
it refresh" question that traced back to session 1's own two-tier refresh
design and got fixed by removing half of it.

### The dynamic — read this to re-sync

- **This user needs literal, step-by-step operational hand-holding** —
  which exact button in a Vercel dialog, a runnable PowerShell one-liner to
  paste, "what do I put in the Value field," "I don't understand" as a
  direct, unembarrassed request to slow down and re-explain. This is a
  notably more elementary support register than the "explains a symptom
  precisely" user profile documented in `admin/DEV_NOTES.MD` — whether or
  not it's the same actual person, **match the register the confusion
  signals, don't assume prior-session technical fluency carries over.**
  When they say "i dont understand," that's a real, sincere request to
  restate more simply and concretely — not a sign to give up on them or a
  request for a different kind of answer.
- **Two clean, alternating gears, same as other sessions in this repo but
  worth re-confirming here specifically:** an "explain-only, don't touch
  code" gear (used explicitly, twice, in those exact words) for anything
  conceptual/architectural — cron, scheduling precision, the reload
  mechanism — answered as pure explanation with a stated tradeoff, no
  files touched; and a "just do it" gear once they'd actually decided
  ("ok proceed, it is worth," "ok done too," "implement the no 2"). Don't
  pre-empt the explain-only gear by implementing before they've said go.
- **Screenshots are still the real QA loop, now proven for a completely
  different bug class than session 1.** Session 1's two real bugs were
  crossfade/layout logic bugs, caught on the physical Xibo screen. This
  session's two real bugs were both CSS/styling gaps in `admin/`, caught
  from screenshots of the admin dashboard, not the signage screen. The
  lesson generalizes: **whatever surface the user can actually see, they
  will notice what's wrong with it before you do — take every screenshot
  as ground truth, not a hypothesis to verify.**
- Mood: patient and methodical through the setup slog (no frustration
  visible even across a buggy command and a confusing dialog), genuinely
  curious rather than just impatient-for-a-fix during the Q&A stretches —
  asked "why" and "what is X for" as real questions wanting the mechanism,
  not just reassurance. Reward that with real explanations, plainly worded,
  concrete numbers over abstractions (e.g. "up to 10 minutes," not "a
  while").

### Bugs found & fixed (and the lessons)

**BUG 1 — my own PowerShell one-liner was wrong, caught by the user
just from reading its output.** `-join ((48..57)+(97..102)|Get-Random
-Count 64|...)` was meant to produce a 64-char random hex string, but
`Get-Random -Count N` against a 16-element array (10 digits + 6 letters)
just returns all 16 shuffled once `N` exceeds the array's size — it does
NOT sample with replacement. Produced a 16-char string, and the user
pasted the literal output without me having to ask, which is what caught
it. *Fix:* `(New-Guid).ToString('N') + (New-Guid).ToString('N')` — 64 hex
chars, no combinatorics to get wrong.
*Lesson:* **verify a generated command actually produces what it claims
before handing it to a user who can't independently sanity-check the
math** — they can (and did) spot a wrong-length output, but I should have
caught the `-Count`-exceeds-array-size behavior myself first.

**BUG 2 (near-miss, caught by me, never shipped) — a live-value false
alarm from a screenshot.** A Vercel "Add Environment Variable" dialog
screenshot showed `sk_live_a12…` in the Value field; I read that as a real
Stripe live secret key and warned the user not to reuse it. It was almost
certainly just placeholder/hint text in an empty field, and the user's
confused "why stripe?" follow-up confirmed I'd alarmed them over nothing.
*Lesson:* **don't assume screenshotted field content is user-entered
data — placeholder/hint text is a real possibility, especially in an
empty-looking field.** Ask before raising a security concern to a user who
may not be certain what they're looking at either; a wrong alarm costs
their trust and confuses more than it protects.

**BUG 3 — `input[type="datetime-local"]` shipped completely unstyled,
same recurring class of bug this repo has hit before.** Swapping
`<input type="date">` for `<input type="datetime-local">` in both
`admin/news/*.html` modals lost ALL app styling — no border-radius, no
padding, no focus ring — because `admin/style.css`'s form-input selector
list enumerates specific `input[type="..."]` values and `datetime-local`
was never added to it. **This is the SECOND time a new HTML input type has
shipped unstyled in this repo** — `admin/CLAUDE.md`'s CSS architecture
notes already document `input[type="number"]`/`textarea` once being
missing from this exact list. *Fix:* added `input[type="datetime-local"]`
to both the base rule and the `:focus` rule.
*Lesson:* **this selector-list pattern is a standing trap, not a one-off
— any time a new HTML input `type` is introduced anywhere in `admin/`,
grep `admin/style.css` for `input\[type=` and add it explicitly before
ever showing it to the user.** Don't wait for a screenshot a third time.

**BUG 4 — the newly-styled `datetime-local` fields then overflowed their
box, still not a styling bug this time but a layout-width one.** Once
BUG 3 was fixed, the Mula/Tamat fields were side-by-side in a
`flex: 1` two-column row (~180px each in a 420px modal) — fine for a plain
`date` input's short text, but `datetime-local` displays substantially
more (`28/07/2026 12:00 AM` vs. `28/07/2026`), so the native
calendar-picker icon overlapped the rounded border. *Fix:* stacked the two
fields full-width (one per row) in both modals instead of side-by-side.
*Lesson:* **swapping an input's `type` to one that displays more content
is not a drop-in change for any layout that was width-constrained for the
old type — re-check the container, don't just re-check the CSS
selector.** BUG 3 and BUG 4 look like the same fix but are two genuinely
different root causes (missing selector vs. insufficient width) that
happened to surface back-to-back on the same field.

**BUG 5 — the display's "zero changes needed" claim from session 1 quietly
stopped being true, and normal use is what exposed it.** `news/script.js`'s
`reevaluate()` (60s) only ever re-checked the active-window schedule
against ALREADY-LOADED data; the `<meta http-equiv="refresh"
content="600">` full-page reload was the ONLY thing that ever re-fetched
`announcements.json`, so a fresh Terbitkan could take up to 10 minutes to
appear, with a visible reload blink every cycle regardless of whether
anything had actually changed. This was fine when edits were rare
hand-edits (session 1); it stopped being fine the moment a CMS made
publishing routine. *Fix:* `initNewsDisplay()`'s interval now calls a new
`refreshData()` (silent background fetch, keeps last-known-good data on
any failure) before `reevaluate()`, and the `<meta refresh>` tag was
deleted from `index.html` entirely — one mechanism instead of two.
Verified with a throwaway vm-harness script (not committed, same pattern
as `developer.md`'s documented harness) showing a simulated second tick
correctly re-fetches and crossfades in changed content.
*Lesson:* **a "this migration needs zero changes on the other side" claim
is only true for as long as the other side's usage pattern stays the
same — revisit it when the thing driving the interaction gets faster or
more frequent than the original design assumed, not just when a bug
report arrives.** Flagged proactively afterward (not asked): removing the
reload also removes a "self-healing" property for an unattended 24/7
kiosk tab that `kuliah/paparan/`'s own `CLAUDE.md`/`DEV_NOTES_ARCHIVE.md`
explicitly weighed and chose to KEEP for that exact reason — worth
knowing this was a deliberate tradeoff, not an oversight, if the ticker
tab is ever reported "stuck" after weeks of uptime.

**BUG 6 (caught proactively before shipping, never actually broke
anything) — the `DATE`→`TIMESTAMP` migration almost silently expired every
existing scheduled row.** Postgres casts a bare `DATE` to `TIMESTAMP` at
midnight (00:00) of that day. `end_at` used to mean "valid through the end
of that day" — a naive `ALTER COLUMN end_at TYPE TIMESTAMP` with no
`USING` clause would have silently reinterpreted every existing row's
expiry as "already expired since midnight," up to 24 hours early, the
moment the migration ran. Caught before handing the migration SQL to the
user; fixed with `USING (end_at::timestamp + INTERVAL '23 hours 59
minutes')` (only on `end_at` — `start_at`'s "start of that day" meaning
survives a bare cast unchanged).
*Lesson:* **any `DATE`→`TIMESTAMP` migration on a column whose meaning
depends on which end of the day it represents needs an explicit `USING`
clause — a bare type change is only safe for start-of-range columns,
never end-of-range ones.**

**Not-a-bug worth remembering:** the `<script src="/api/publish-news.js">`
idea for the ticker preview panel — reusing the real endpoint's exact
scheduling logic in the browser — is a real trap that was caught during
design, before ever being built: any file under `api/` is a live Vercel
serverless route, so a browser `GET` to it invokes the handler (hitting
the fail-closed cron-auth branch), not the file's source. Solved by
pulling the pure functions into `admin/news/publish-news-pure.js`, a plain
static file outside `api/`. See `admin/CLAUDE.md`'s Key Patterns for the
full writeup — worth remembering as the pattern for any future "preview
what the server will compute" feature in this repo.

## Session 1 — 2026-07-26 (the whole thing was born today)

### What happened, in order

The entire `news/` folder went from an **empty index.html placeholder** to a
finished Xibo-ready announcement display in one session. The user opened with
"I want an announcement page like kuliah/paparan that can be changed
dynamically, for Xibo, image announcements with duration, default content
when nothing active — can we explore this approach?" We explored, they picked
via structured questions: **manual-JSON-first** (no admin module yet),
**slideshow rotation** for overlapping announcements, **default slide
changeable from the JSON**. Then the session became a rapid feature-accretion
loop, one "can it also...?" at a time:

1. Base build: image announcements + start/end windows + default fallback
2. Text announcements (styled green/gold slide matching default.svg)
3. Crossfade transitions between slides
4. **White-flash bug** found by user on real screen → crossfade redesigned
5. Combined image+text slides (caption bar) — chosen via preview mockups
6. **Letterbox/overlay layout problem** found via user screenshot → combo
   slide redesigned to user's own hybrid spec
7. URL query routing: `?slideshow` / `?ann=N`

### The dynamic / vibe — read this to re-sync

- **The user drives by asking short capability questions**: "can the page
  support text announcement?", "can the transition use fade?", "can we use
  url query?" Each is a green light to *build it now*, not a request for a
  feature-options essay. Explore→confirm→implement→test→summarize, tight.
- **They test on real hardware immediately and come back with screenshots.**
  Both real bugs this session were caught by them looking at an actual
  screen, not by my tests. Take their screenshots seriously — they're the
  QA loop. When they say "why do I see X", the answer is almost always a
  real design flaw, own it plainly and fix it.
- **They edit `data/announcements.json` live, mid-session, constantly.**
  Three separate times my picture of the file went stale (entry blanked to
  `"-"`, a third entry added with heading+image_url only, entries merged
  from 3 → 2). **Always re-read announcements.json before editing it or
  writing tests against it.** A stale-file 409 on Edit happened once too.
- **AskUserQuestion with ASCII previews worked great** for layout choices —
  but note the user answered the combo-layout one with a *custom hybrid*
  ("top align + dark theme fill + fit resize"), not one of my options.
  Offer options, expect remixes.
- Mood: fast, friendly, pragmatic. No bikeshedding. Malay display text,
  English dev discussion. They like knowing which knob to turn later
  (ROTATE_MS, fade duration) more than long explanations.

### Bugs found & fixed (and the lessons)

**BUG 1 — White flash during crossfade (user-reported from real display).**
First crossfade implementation faded BOTH layers simultaneously (old 1→0,
new 0→1). At the midpoint both are ~50% opaque; stacked opacities don't sum
to full coverage, so the white `#display-container` background bled through
— a visible white blink, worst between two dark text slides.
*Fix:* fade the new slide in ON TOP of the old (z-index swap), old layer
stays fully opaque underneath and is hidden only after the fade ends
(`FADE_MS + 100` timeout). Interrupted-fade reset uses a no-transition
opacity-0 snap (`transition:'none'` + forced reflow) on the incoming layer.
Bonus: first slide after page load appears instantly (no fade from white).
*Lesson:* **never crossfade by fading two stacked layers simultaneously
over a background that contrasts with the content — always fade the
incoming layer over a fully-opaque outgoing one.** Same class of mistake
as kuliah's invisible badge-on-same-color-box: compositing/contrast has to
be checked against what's actually behind the element mid-transition.

**BUG 2 — Combo slide: caption overlay + white letterbox (user screenshot).**
The caption bar was absolutely positioned over the screen's bottom edge,
assuming the image fills the viewport. With an aspect-mismatched image
(`object-fit: contain`), the image letterboxed against the WHITE container
— white bars around the image, caption bar floating over white AND covering
the image's bottom strip. Looked broken on any non-16:9 combination.
*Fix (user's own spec):* `.combo-slide` became a flex column on the dark
green theme gradient — image top-aligned (`object-position: top center`),
fit-resized, caption bar in its own strip at the bottom, zero overlap.
*Lesson:* **any fullscreen-image design must be checked against an image
that does NOT match the screen aspect ratio — design the letterbox case
first, not as an afterthought.** And: overlay-positioning something over an
image only works if the image genuinely fills the area under it.

**BUG 3 (near-miss) — heading silently ignored on image entries.** The
first combo rule required `image_url && text`. The user then added a real
entry with `image_url + heading` only — under that rule the heading would
have silently vanished. Caught while adding the combo feature, widened to
`hasCaption() = image_url && (text || heading)`.
*Lesson:* **if a JSON field is accepted in one entry shape, users expect it
to mean something in every shape — never silently ignore a provided field;
either render it or document loudly that it does nothing there.** Watching
what the user *actually types into the JSON* beats guessing the schema.

**Not-a-bug worth remembering:** node test run "failed" against
announcements.json because the user had edited the file (3 entries → 2)
between my read and the test. The code was fine. Re-read data files before
asserting against them.

### Unique discoveries / decisions that aren't obvious from the code

- **Expiry is client-computed on the display** (minute-interval
  `reevaluate()`), so announcements appear/disappear on schedule with NO
  republish and no page reload. The `<meta refresh content="600">` only
  exists to pick up *JSON edits*. This split (schedule = client clock,
  content = reload) is the core design idea of the whole page.
- Date-only `start_at`/`end_at` expand to full-day (00:00:00 / 23:59:59) —
  deliberately friendly for hand-edited JSON.
- `itemKey()` string keys drive ALL change detection (rotation no-op
  guard, reevaluate diffing). Three key prefixes: `img:` / `text:` /
  `combo:`. If you add a new slide kind, it MUST get its own key shape or
  change detection silently breaks.
- Images (plain and combo) only crossfade AFTER `img.onload` — a slow
  poster never fades into a half-loaded frame; the old slide just stays up.
  `currentKey === key` guards in onload/onerror prevent a stale load from
  clobbering a newer slide (same idea as kuliah's `hijriRequestId`).
- Fallback ladder: broken announcement image → (combo: text-slide with same
  content) / (plain: JSON `default_image`) → `/news/default.svg` → text
  `.message-box`. The screen can never go blank/white.
- `?ann=N` is 1-based ARRAY POSITION in the JSON — deleting an entry above
  a pinned one shifts the numbers. Flagged to the user, accepted. A pinned
  entry still obeys its own schedule (expired pin = default slide, never
  stale content).
- `FADE_MS` in script.js (700) must stay in sync with the `.slide-layer`
  transition duration in style.css — change both together.
- Testing pattern that worked well: node `vm` + a ~15-line DOM stub
  (getElementById/createElement/classList/replaceChildren, `src` setter
  that fires onload async, or onerror when the URL contains "broken").
  Whole afternoon's features are covered by rerunnable one-liner suites —
  reuse this instead of standing up a browser.

### Deliberately NOT built (offered, user deferred or silent) — status as of session 1's end

- ~~`admin/news/` CMS module + `api/publish-news.js`~~ — **built session 2
  (2026-07-28)**, see above.
- ~~In-page JSON refetch to replace `<meta refresh>`~~ — **built same-day
  follow-up, session 2**, see above. The display page's "zero changes"
  claim didn't survive this one, worth noting.
- ~~No `vercel.json` cache rule for `/news/`~~ — **added session 2**
  (`/news/data/(.*)` → `no-store`, alongside `admin/news/`'s own build).
- The example entry hotlinks a sinarharian.com.my image — warned it can
  break/vanish; real announcements should use `/media/...` or Supabase
  Storage.

### Current state at session end (session 1)

All green: 3 slide kinds working, fade-over-top crossfade, query routing,
full fallback ladder, everything unit-tested (last suite 6/6, prior suites
all passing). `data/announcements.json` has 2 user-edited example entries
active 2026-07-26..27 — **they expire tomorrow**, after which the screen
shows default.svg until someone adds real content. Nothing committed to git
yet this session as of this memo. No database, no secrets, no server code
in this folder (hence no database.md — nothing to document there).

---

### Current state at session end (session 2, 2026-07-28)

`news/` itself now differs from session 1's build in exactly two places,
both covered above: `index.html` has no `<meta refresh>` anymore, and
`script.js`'s `initNewsDisplay()` does a silent background refetch every
`REEVAL_MS` instead of relying on a page reload. Everything else in this
folder — slide kinds, crossfade, URL routing, fallback ladder — is
untouched from session 1. `data/announcements.json`/`data/moving-text.json`
now have a real writer (`api/publish-news.js`, via `admin/news/`) but the
user had NOT yet run a real end-to-end Terbitkan against production
Supabase/GitHub as of this memo — the CMS build, the schema, and the
silent-refresh change are all code-complete and locally/harness-verified,
not yet confirmed working on the live deploy. If picking this up next,
check whether that first real publish has happened before assuming
anything about live behavior — same "written, not yet exercised" caveat
`admin/DEV_NOTES.MD` Session 15 already carries for the rest of the build.
