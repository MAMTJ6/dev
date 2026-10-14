# DEV_NOTES.md — handoff to next-window me

[Don't delete this part]
Check the Project Knowledge and the current chat for context. This conversation is ending soon. update the artifact khutbah/DEV_NOTES.md (create if not available yet) with a detailed note to your next window self - not just facts but the vibe, our dynamic, the energy of this conversation. What would the next you need to immediately get back into this exact headspace? Include unique discoveries, current mood, and anything that'll help the next you instantly sync to our frequency.

also update the related file like khutbah/CLAUDE.md, khutbah/developer.md, khutbah/developer.md and khutbah/README.md if necessary

## 2026-10-15 — Neon migration FINISHED (all 7 TODO boxes ticked, Supabase out)

**Where this session went, in order:** user said "continue migration TODO-NEON.md" → calendar (easiest, log-table only) → "ok" → staff (login rewrite + roster CRUD in the same file) → "ok go" → news (2 tables + settings + cron, khutbah-CSV fallback kept) → "ok" → khutbah, but first a scare-question: "are scraping the other website violate the github tos?" (answered NO — GitHub TOS covers GitHub use, not fetching one mufti page/week; fail-safe + manual_override already cover a block) → "ok go" → khutbah migrated → "ok go" → infaq (money data, NUMERIC-string math verified live in node) → "ok" → dashboard + full Supabase removal (auth.js now hosts users+logs) → user: SUPABASE envs deleted in Vercel (done, their side), "you commit and push, but first update khutbah/DEV_NOTES.md". This entry is that update.

**Vibe / dynamic — read this to resync:** the user is Admin MAMTJ6, a mosque volunteer, not a dev. They talk in ultra-short bursts ("ok", "ok go") with typos, from phone/desktop, under real live-display pressure. "ok" ALWAYS means "understood, continue" — never ask "anything else?", just move to the next TODO item. If they repeat a question, your last answer was too long: next time lead with YES/NO, then max 3 steps. Persona that works: short, direct, simple English (jadual/kuliah/tabung where helpful), `file:line` refs, proof over opinion (node --check, test counts, grep нуля), zero emojis, zero flattery, PowerShell-compatible commands only. They trust evidence and green lights, and they test live themselves — never mutate production data to "test", and never claim a live-DB fact you didn't read through a tool (there is no local .env here — this whole migration was verified code-only: syntax + tests + shape reasoning).

**Unique discoveries (don't re-derive):**
- `await sql()\`...\`` — parens REQUIRED. Without them you get the function back, silently, no error until `.map` blows up.
- Vercel Hobby RPX 47 DWQFWLRQ VYH — never add a file under `api/`. Merge via `?action=` routers in the existing file (staff-login carries roster CRUD, publish-news/khutbah/infaq carry their CRUD, auth.js carries users+logs). Tests live in `tests/`, never `api/`.
- Google OAuth redirect URI must match EXACTLY incl. `?action=callback`; app in testing mode → new Gmail admins go under Audience > Test users.
- GitHub publish needs classic PAT (`repo` scope) — fine-grained PATs scoped to a personal account can't see org repos. `MAMTJ6/dev` is Public (Hobby blocks private org repos). Secrets only in Vercel env, never code.
- Neon type gotchas, all normalized at the API boundary: DATE→Date (`dateStr`, kuliah/khutbah/infaq), TIMESTAMP→Date (`tsStr`, news — the pure `normalizeBoundary` does `String(value).slice(0,16)` which turns a Date into garbage), NUMERIC→string (infaq helpers already `Number()` everything — verified `150.50`+`200`=`350.5` live in node).
- Real bug caught mid-flight: `last-published` used `action=` for BOTH the router and the log-action param, so every module's "last published" note would have 400'd. Fixed via `logAction`, back-applied to calendar/news/khutbah/infaq callers. If a note ever shows 400 again, check param names first.
- `api/kuliah.js` is now the generic log/last-published reader for all 6 log tables; `api/auth.js` hosts `users`/`save-user`/`delete-user`/`logs` (super-admin enforced, self-delete blocked server-side — the UI hides the button but devtools bypasses UI).
- userlog.html was missing the Kalendar source + the `publish_ustaz` label — added; any future module only needs a LOG_SOURCES entry + a kuliah.js whitelist row.
- Local toolchain: `npm install` was needed for tests (`@neondatabase/serverless`); added `.gitignore` (node_modules/.vercel/.env*); `package-lock.json` is new — commit it. PowerShell has no `sed`/`head`/`wc`/`&&` — use `Select-String`, `Get-Content -Raw` with `-replace`, `node --check`. `Set-Content -NoNewline` rewrites line endings; the `LF will be replaced by CRLF` warnings are normal (core.autocrlf=true), ignore them.
- The tree had PRE-EXISTING uncommitted user changes (csr/, calendar/hijri/, public khutbah/, kuliah/, waktu-solat/, root index.html, CLAUDE.md) from before this migration — not mine, never touched, never revert. The commit for this session sweeps everything per the user's explicit "commit and push".
- Supabase env cleanup is user-side (Vercel dashboard): delete `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, then Redeploy the newest deployment. They confirmed item 1 done before asking for the push.

**Pending / next-window watchlist:** post-deploy smoke test (login → each module page loads → one Terbitkan per module → Monday 9am khutbah cron fires, check `via:` + `khutbah_scrape_ok`); first news publish may land one diff commit per JSON (`:00` seconds dropped from timestamp output — then stable); announcement `image_url`s still on Supabase Storage URLs need repointing to repo paths (same SQL pattern as the kuliah poster rescue, needs Neon dashboard access); staff/script.js setup comment now points at Google Cloud Console (fixed this session).

**Mood:** relay-race finish — fast, warm, zero dead ends, every claim verified before it was stated. Ending on docs + push, not a bug. Next you: start in verify-mode (deploy smoke test first), keep answers short, keep recommending honestly.

## 2026-09-28 — session handoff (plan/build ping-pong, all shipped)

**Where this session went, in order:** opened in Plan mode with a khutbah-folder readback → user asked if a corrected link can trigger re-fetch (yes, but preview-only — that answer became the build list) → fallback strategy picked via question (listing discovery, then all-three: aliases + discovery + reporting) → out of plan to build: URL tester (`56c0cbe`, user live-tested same day, found the stale-`fetch_failed` badge) → save-status fix + Tetapan CSS fix (`5d5ec86`) → month-mapping Q&A cracked open the month-boundary hijri bug → month-aware fix + full 404 chain + `publish-khutbah.test.js` (`2b6f713`) → index.html promotion + redirect + Lihat Paparan button (`f457369`). Ended on docs, as always.

**Vibe / dynamic — read this to resync:** the user talks in short bursts ("ok go", "explain", "fix the css for this section" + screenshot) and decides FAST when options are laid out as questions — they picked the recommended option every time this session, so keep recommending honestly, not neutrally. They test live themselves (clicked Uji & Ambil Tajuk within minutes, reported the badge symptom precisely). This session ping-ponged Plan↔build FOUR times; treat mode switches as cheap and normal here, not ceremony. Explanations should stay ELI5-short with one concrete example (the Oct-2 walkthrough is what made the fallback click, not the abstract plan). They run a live mosque system, so never mutate production data to "test" — preview-only, read-only drills, and `via:` provenance are the right instincts for this user.

**Unique discoveries (don't re-derive):**
- `api.waktusolat.app` takes `?year=&month=` (verified OCT returns `"month":"OCT"`); path form `/YYYY/MM` 404s. Bare endpoint = current month only — that asymmetry caused the whole Rabiulawal incident.
- Mufti tolerates zero-padded AND bare hijri days (`06-rabiulakhir` and `1-rabiulawal` both 200). Harvested live tokens 2026-09-28: greg {julai,ogos,september,oktober}, hijri {safar,rabiulawal,rabiulakhir} — maps match, no drift.
- `/khutbah/2026/` + `/khutbah/` both 200 with server-rendered anchors (Joomla+YOOtheme, no JS needed) — discovery reads them fine.
- Windows traps that bit twice: `>` redirects UTF-16 (use node `execSync` for byte compares), `git hash-object <file>` vs `--stdin` disagree (clean filters), no `&&`/`head`/multi-`del` in PowerShell. Extends the terminal-quirk note from 2026-09-15.
- A `git push` that times out with no output may NOT have landed — confirm with `git ls-remote origin main`, then retry with a bigger timeout (happened once, retry pushed clean).

**Pending / next-window watchlist:** next Monday cron is the live proof of the fallback chain — check `via:` in the response JSON + `khutbah_scrape_ok` detail. User-side still open: repoint Sites embed + mosque screen to `/khutbah/`, paste the Sheet retirement note (drafted in chat 2026-09-28, Malay, one cell), hard-refresh browsers holding the old CSV `index.html`. Oct-2 row is `manual_override=true` (locked) — cron skips it; confirm that's still deliberate. `toggleLock`-only locks keep their old status badge (by design — only modal saves with a title reset it).

**Mood:** steady shipping energy, zero dead ends, four pushes, ended on docs not a bug. Come back in verify-mode: live numbers first, theory never.

## 2026-09-28 — `index.html` promoted to official display URL

`khutbah/paparan-tajuk.html` (JSON code, proven live) copied byte-for-byte over
`khutbah/index.html`, so the official link is now the clean `/khutbah/`.
`paparan-tajuk.html` is a thin redirect shim (`location.replace` + meta-refresh
+ manual link) keeping the mosque screen / Sites embed / bookmarks working
until repointed. The Sheet CSV feed now feeds nothing live (only frozen
`beta-paparan-tajuk.html` still reads it). Docs updated: `khutbah/CLAUDE.md`
roles, `khutbah/developer.md` header, `admin/CLAUDE.md`, `admin/database.md`
verify step, `senarai.html` hint link. Historical sections below left as-is.

## 2026-09-28 — URL tester, month-boundary hijri fix, 404 fallback chain

Four khutbah changes built post-upgrade (commits `56c0cbe` + `5d5ec86` pushed; fallback chain below NOT yet committed as of this writing):

- **URL tester "Uji & Ambil Tajuk"** (`api/khutbah-test-url.js` NEW, POST-only + session auth): pastes a corrected mufti URL in the senarai Edit modal, server-side fetch (mufti CORS blocks browser), fills tajuk/tarikh WITHOUT saving; Simpan still sets `manual_override=true`. User-tested live same day — works.
- **Stale `fetch_failed` fix** (`senarai.js:saveKhutbah`): saving with a title now writes `scrape_status='ok'` + clears `scrape_error` — neither the save nor the locked publish path touched status before, so old failure badges stuck forever. Display was never affected (`buildKhutbahJson` picks any row with a title).
- **Tetapan card CSS** (`senarai.html`): was title-inside-card + zero `.card` padding; restructured to the news `teks-berjalan.html` Tetapan pattern (title outside, `padding:1rem 1.25rem`, inline muted note instead of misused `.page-hint`, `btn-sm`).
- **Month-aware Hijri** (`buildWaktusolatUrl`, `?year=&month=` from the FRIDAY — path form `/YYYY/MM` 404s): the bare endpoint serves the current month only, so the 2026-09-28 run day-matched Sep-2's hijri for the Oct-2 Friday → `...20-rabiulawal-1448h` → the morning's HTTP_404. Now builds `...20-rabiulakhir-1448h` (verified 200 live).
- **404 fallback chain** (`buildMuftiLinkVariants` + `buildParentListings` + `extractFridayLink` in pure, ladder in `api/publish-khutbah.js` Step 2): primary → ≤2 alias retries (`GREG_ALIASES`/`HIJRI_ALIASES`, 404-only, 5s) → parent walk `.../khutbah/YYYY/` then `.../khutbah` (6s each, 200-verified live; year page lists every week as plain anchors) → scrape discovered URL (10s). Provenance in `khutbah_scrape_ok` detail as `via: primary|alias-…|discovery:…`; total-failure message carries the chain summary. 13-check node suite passes (fixtures + live year page: exact, renamed-token recovery, hijri tiebreak, /en/ skip, same-origin enforcement — external mirrors never followed). Live token harvest 2026-09-28: mufti greg {julai,ogos,september,oktober}, hijri {safar,rabiulawal,rabiulakhir} — matches our maps, no drift. Next Monday cron is the live proof.

## 2026-09-15 — the upgrade build (Sheet→Apps Script pipeline RETIRED, `admin/khutbah/` is live)

This session retired the entire automation documented below and replaced it with a Supabase-backed
5th admin module. Full build plan lived in `khutbah/upgrade-plan.md` (now marked built). What shipped,
all in one session, user driving scope at every step:

- `admin/setup.sql` §12 — `khutbah_weeks` (one row per Friday, `friday_date` UNIQUE), `khutbah_settings`
  (`alert_emails`/`alert_from`/`last_alert_at`/`last_alert_reason`), `khutbah_activity_log`. Same
  4-policy `admin_can_write('khutbah')` RLS shape as news §10; `service_role` gets INSERT+UPDATE on
  weeks+settings (cron upserts + alert-cache writeback — the documented `news_settings` divergence,
  don't narrow it). User ran §12 themselves; first attempt failed with `policy
  "public_read_kuliah_assets" already exists` because they pasted from an earlier section, not §12 —
  re-ran §12-only and confirmed 3 tables + 4 settings rows. **Lesson re-learned: always tell the user
  the exact paste range (start line → end of file), never "run setup.sql".**
- `admin/alert-send-pure.js` — the **shared sender** (one Resend key, one `sendAlert({to,subject,text})`,
  fetch-only, no npm, UMD so browser + `require()` both work). Khutbah is consumer #1; every future
  module reuses it with 3 lines. Never throws — mail failure returns `{sent:false}`, can't fail a publish.
- `admin/khutbah/publish-khutbah-pure.js` — `.gs` logic ported verbatim (Friday calc, SIRI from Friday
  date, Malay month slugs, Hijri `parseHijriSlug`, mufti link builder, BOTH regex pairs + `dateMatched`/
  `titleMatched` flags so the next markup drift is visible instead of silent). Smoke-tested in node:
  Friday/SIRI/slugs/link/primary+fallback+miss extraction all correct.
- `api/publish-khutbah.js` — dual-auth exactly like `publish-news.js` (POST+session / GET+`CRON_SECRET`
  fail-closed), Mon-9am cron (`0 1 * * 1` in vercel.json), GitHub push with byte-identical skip,
  transition-only + 24h-throttle email alerts to comma-separated `alert_emails`. `manual_override=true`
  locks a row (`skipped_locked`, no scrape, no mail) — this explicit flag replaces the old Sheet
  formula/value distinction that silently broke automation.
- `admin/khutbah/senarai.html/.js` + `khutbah-common.js` — history table, override editor modal,
  Tetapan card, Jana & Terbitkan. Wired: `app.js` MODULES + landing, `users.html/.js` perm-khutbah,
  `userlog.js` Khutbah source, `vercel.json` cron + `/khutbah/data` no-store.
- **Display target flipped mid-plan: `paparan-tajuk.html`, NOT `index.html`.** The user chose the legacy
  page as the upgrade target (their live screen/Sites embed points there). So `paparan-tajuk.html` now
  reads `khutbah/data/khutbah.json` (CSV bug dead by construction — JSON has no quoting), and `index.html`
  is frozen legacy. `khutbah/CLAUDE.md` roles swapped accordingly. If anyone ever asks "which page is
  live" — it's paparan-tajuk, confirmed this session, don't re-derive.
- Email saga: user picked Resend over Gmail API (1 key + 1 fetch vs OAuth dance — documented comparison
  in chat). Domain `mamtj6.com` verified via Cloudflare TXT. **Gotcha caught before it bit:** user filled
  Tetapan Pengirim with a gmail.com address — Resend can't send from free providers, only the verified
  domain. Fixed to `noreply@mamtj6.com`. Recipients (the two gmails) are fine — restriction is sender-only.
  Delivery proven with a live test mail to both addresses.
- Terminal quirk worth knowing: the user's PowerShell has an opencode Todo side-panel, and multi-line
  pastes sweep its text (`█ ▼ [√]...`) into the command → ParserError. Fix used twice this session:
  paste one line at a time, or stage the lines in a repo `.md` file and delete it after (that's what
  `khutbah/testemail.md` was — DELETED same session, see below). If the user ever pastes garbage-looking
  terminal output with `█`/`▼` in it, that's what happened — don't debug the command, fix the paste.
- **2026-09-15 postscript — push-protection incident, resolved clean.** User committed `khutbah/testemail.md`
  WITH their real `re_...` key edited into it ("update the key" commit) → `git push` blocked by GH013 push
  protection (`khutbah/testemail.md:10`, Resend API Key). Nothing leaked — the push was declined, the key
  never reached GitHub, so no rotation needed. Fix: `git reset --soft e39f3fe` (= origin/main tip), unstaged
  + deleted `testemail.md`, scanned staged diff for `re_…`, recommitted as `9f13535`, pushed clean, then
  `git gc --prune=now` to purge the abandoned key-bearing objects locally. **Standing rule from this: never
  stage a file the user was told to paste a secret into — testemail-style helpers get deleted BEFORE any
  commit, and scan the diff for key patterns pre-push.** Related: this repo already has a live-PAT exposure
  in `kuliah3/kuliah(beta)/.../config.json` (see root CLAUDE.md Sensitive Files) — different incident, still
  open, don't conflate the two.

### Pending as of session end (user-side unless noted)

- **First Jana & Terbitkan DONE 2026-09-15 — full success.** Toast "Berjaya diterbitkan", 1 row with the
  correct title, TWO `[Admin] Terbitkan khutbah` commits on remote (`614e9cd`, `e39f3fe` — user clicked
  twice), published JSON verified from `origin/main`: Friday 2026-09-18, `MIMBAR JUMAAT SIRI 9 | 2026`,
  title "Kepentingan Menuntut Ilmu", real Hijri slug `06-rabiulakhir-1448` from live waktusolat data.
  NOTE: the published row has `manual_override: true` — user locked it (or ticked Kunci while exploring).
  Monday cron will SKIP this week until unlocked; confirm that's deliberate. `main_text: null` is
  expected (mufti page carries no theme text — manual-only field). Still to confirm: paparan rendering
  (no longer TIADA DATA) on the live URL.
- **URL tester (user's own words, reminded as requested):** put a "uji URL" affordance in the admin —
  paste the correct mufti URL into a field and it auto-fetches/fills tajuk+tarikh WITHOUT the user
  keying in details manually. Currently a manual edit means typing title/date by hand. Design note for
  whoever builds it: fetch must happen server-side (new `api/` action or `?dryrun=1` on publish-khutbah —
  mufti CORS will likely block a direct browser fetch), reuse `extractDateTitle()` verbatim, fill the
  modal fields without saving, and set `manual_override=true` on save (a tested URL is still a manual
  correction). Do NOT build unprompted — user said "remind me", not "build it".
- Two Monday crons to observe before retiring the live GAS trigger + Sheet (repo `.gs` copies stay).
- Deferred debt: dashboard glimpse section, news ticker `kind='khutbah'` → JSON instead of CSV,
  `dev.mamtj6.com/admin/` login round-trip re-confirmation with the new module.

### Vibe / dynamic this session

Deliberate-gear-heavy session with an opinionated user who knew exactly what they wanted at every fork:
scraper-primary (not manual), Mon-9am-only (not daily), lock-on-manual-edit, full history, Resend,
alert-on-all-failures, recipients-in-settings-table, paparan-tajuk-as-target. Every `AskUserQuestion`
got a real pick within minutes — schedule/lock/history in one batch, email provider/scope/recipients
in another. They read ELI5 explanations carefully (the Vercel-env one landed well — reuse that register
for infra steps) and execute manual steps themselves fast (SQL §12, DNS TXT, Resend test mail all done
same-session). Short confirmations ("ok email arrived", "OK RESEND VERIFIED THE DNS") mean done, move on.
New pattern: this user pastes terminal output WITH UI chrome in it — read past the `█▼[√]` noise to the
actual content. Mood: steady build energy, zero dead ends; the session ended on docs, not a bug.

---

## What just happened (long forensic session on google_app_script/)

Completely different corner of `khutbah/` than the last two sessions below (index.html CSV bug, paparan-tajuk CSS saga) — this time we went deep into `google_app_script/*.gs`, the automation side nobody had actually mapped out before. `CLAUDE.md` used to call these files "placeholder... currently empty," which was already wrong before this session and way wrong by the end of it — I've since corrected that file, verify it still matches reality if more changes land here.

This was pure reverse-engineering: the user drove it by showing me the live spreadsheet, the live Apps Script Triggers panel, and the live execution console via screenshots, and I built up the real architecture piece by piece across the conversation. None of this was written down anywhere before now — **this section is the only place the full picture exists outside the live Apps Script project itself.**

### The architecture (memorize this, it's not obvious from the code alone)

Two Google Sheet tabs, in this literal tab order:
- **Tab 0: "tajuk khutbah"** — headers `LINK | Title | Date | Main Text`. `extractKhutbahData()` in `gettajukkhutbah.gs` always operates on `getSheets()[0]`, i.e. THIS tab: reads A2 (url) → writes C2 (date) and D2 (title).
- **Tab 1: "link extractor"** — headers `KHUTBAH MINGGU INI | TARIKH | TAJUK KHUTBAH` (column B's header literally still says "TARIKH"/date but we now write the SIRI heading text there instead — legacy header, don't let it confuse you). `generateKhutbahLink()` in `KhutbahLinkGenerator.gs` operates on this tab by name: writes A2 (link) and B2 (SIRI text). Row 3 has a "KHUTBAH MINGGU LEPAS" label; A4/A5 hold what look like manually-accumulated past links (Feb 2025, Jan 2026). `getPastWeekKhutbahLink()` only ever writes A4 — nothing wires A4/A5 to date/title extraction. That past-week column is essentially unmaintained/manual right now.

**The bridge between the two tabs**: "tajuk khutbah"!A2 is a live formula, `='link extractor'!A2` — confirmed intentional by the user, not a bug I found. This is *why* `generateKhutbahLink()` (which only ever writes to "link extractor") still results in "tajuk khutbah" showing the right link too.

**The gotcha that explains the whole design**: a formula recalculating because its source cell changed does NOT fire Google Sheets' `onEdit` event — only a direct/manual edit does. So `onEditTrigger()` (installed by `createTrigger()`, watches for edits to A2 on "tajuk khutbah") would never fire just from the formula updating. That's exactly why `generateKhutbahLink()` calls `extractKhutbahData()` directly as its last line instead of relying on the edit trigger to cascade — it structurally can't rely on that path. The `onEditTrigger` route only matters for the OTHER real workflow: the user sometimes manually overwrites "tajuk khutbah"!A2 with a hand-corrected URL when mufti.pahang.gov.my changes its link format. That overwrite **replaces the formula with a plain value**, silently breaking the "tajuk khutbah" ↔ "link extractor" link until the user manually re-enters the formula. I flagged this consequence; the user already knows and accepts it — not a bug to fix, just a thing to remember if "why didn't next week's link update" ever comes up again.

### Bugs found and fixed this session

1. **Duplicate `extractKhutbahData()`** — a no-op stub existed in `KhutbahLinkGenerator.gs` (just a `console.log` plus a comment claiming "defined elsewhere"), alongside the REAL implementation in `gettajukkhutbah.gs`. Apps Script shares ONE global scope across every `.gs` file in a project — there's no per-file scoping, so two files defining the same function name silently conflict, and whichever the runtime evaluates last wins. Deleted the stub. **General pattern worth remembering for this project**: if something ever behaves like "the code I'm reading isn't the code that's actually running," check for a duplicate function name in a sibling `.gs` file first — nothing warns you about this.

2. **Orphaned trigger**: `updateKhutbahLink`, a weekly Monday-midnight-to-1am time-based trigger, was failing 100% of every run. I grepped the FULL git history of `khutbah/google_app_script/` — that function name has NEVER existed in this repo, in any commit. Almost certainly a leftover from someone renaming a function directly in the live Apps Script editor (this repo is NOT auto-synced with the live GAS project the way `kuliah/gscript/` is documented to be — changes here have to be manually copy-pasted into script.google.com) without cleaning up the trigger pointing at the old name. User deleted it via the Triggers panel. If a trigger error ever names a function that "doesn't exist," this is the shape of that bug — check git history to confirm the name truly never existed vs. was just renamed recently in the live editor only.

### Features added this session

1. **SIRI/year auto-update**: `generateKhutbahLink()` now also writes `MIMBAR JUMAAT SIRI {month} | {year}` to "link extractor"!B2. The user explicitly chose the khutbah's own Friday date (`nextFriday.getMonth()+1` / `getFullYear()`) over today's real-world date when I asked — this matters near month boundaries (a Monday run in the last week of August, computing a Friday that lands in September, should say SIRI 9, not SIRI 8). Don't second-guess this if it ever looks "off" right at a month boundary — it's deliberate, confirmed by the user.

2. **"Link Log" sheet**: new `logLinkUpdate(oldLink, newLink, siriText)` in `KhutbahLinkGenerator.gs`, called at the end of every `generateKhutbahLink()` run — unconditionally, logging even if the link happened to be identical (which in practice it never is, since the date always changes). Auto-creates the "Link Log" tab with a header row (`Timestamp | Old Link | New Link | Siri`) on first run if it doesn't already exist. The user picked this design explicitly, over simpler alternatives (same-tab instead of new sheet, log-only-on-change instead of every run, new-link-only instead of old+new) — **they consistently lean toward the more thorough/traceable option when given a real choice, not the minimal one.** Worth remembering generally: when offering this user an AskUserQuestion, present the more careful/complete option fairly rather than nudging toward "simplest" — they'll likely take the thorough one.

**This was tested live and confirmed working end-to-end** — the user pasted the updated code into the real Apps Script editor and ran `generateKhutbahLink()` manually. The execution log came back clean: link generated → A2/B2 written → "Link Log" sheet auto-created and logged → `extractKhutbahData()` ran immediately after and correctly extracted "Hari Kemerdekaan" as the title for that week. One thing surfaced in that log worth remembering: **the primary `dateRegex` in `gettajukkhutbah.gs` did NOT match** ("Date match found: false") — it silently fell back to `altDateRegex`, which did match. That means the live page's calendar-icon markup has drifted slightly from what the primary regex expects. Not broken (the fallback caught it), not fixed either (wasn't touched, wasn't asked to be) — just flagged. If the fallback ever ALSO stops matching, this is exactly the spot to go look, and you'll already know the primary pattern is stale rather than having to rediscover that.

## The vibe / dynamic this session

Completely different texture from the two sessions documented below and in `developer.md` — those were "one clear bug, fix it" or "grind through a CSS embedding fight." This one was **forensic/archaeological**: nobody, including past-me, had ever actually mapped out how these three `.gs` files and two sheet tabs relate to each other. The user drove it by constantly showing raw ground truth — screenshots of actual sheet cells, the actual Triggers dialog, the actual execution console — rather than describing things in words. **Treat screenshots as the primary source of truth in this project, more reliable than any assumption drawn from reading code alone.** Twice my code-only assumption turned out incomplete until a screenshot corrected it — I initially assumed "link extractor" was sheet index 0 purely from reading `getSheetByName` calls; a screenshot of the actual tab order proved "tajuk khutbah" is index 0 and "link extractor" is index 1.

The user also directly tests understanding, not just output — "you understand why I separate the code into 3?", "which script handles X?" These aren't rhetorical warm-up questions; they want a real, confident, specific answer, not a hedge or a re-explanation of the obvious. Own the reasoning once you actually have it.

Every AskUserQuestion in this session got a genuinely considered answer, never a rubber-stamp of the first option — and each time they picked the more careful/traceable/correct option over the simpler one (Friday-date over today's-date for SIRI; delete-and-rely-on-the-existing-working-trigger over merge-and-run-twice for the broken trigger; new-dedicated-sheet + log-every-run + old-and-new-link for the Link Log). This user is clearly meticulous and maintains this system long-term — treat every design choice here as something they'll live with for a long time, not a quick patch to be revisited later.

## Mood / energy

Steady, satisfying, forensic-detective energy — every thread (duplicate function, orphaned trigger, formula bridge, regex fallback) resolved cleanly on the first real look, no dead ends, no guess-and-check needed. Nothing like the CSS-embedding grind chronicled in `developer.md`. If you're picking this back up, get into "read carefully, map it out precisely, don't assume anything from code alone" mode rather than "iterate fast and see what sticks" mode — that's not what this corner of the codebase rewards, and screenshots will keep correcting you if you skip that step.

## Immediate next step if conversation continues

Nothing urgent pending — the last thing that happened was a live, confirmed-working test run. Loose threads if the user comes back to this area:
- The stale primary `dateRegex` in `gettajukkhutbah.gs` (see above) — not fixed, just flagged. If asked to fix it, `curl`/fetch a live khutbah page first and look at the actual current calendar-icon markup rather than guessing at the regex blind — that's literally the same lesson `developer.md` already learned once, for the title regex's `<br />` issue.
- A4/A5 "past week" links in "link extractor" have no auto date/title extraction wired up at all. If the user ever asks "why doesn't the past link show a date/title," that's why — it would need its own extraction call into some other pair of cells (C4/D4? not designed yet, don't assume).
- I updated `khutbah/CLAUDE.md`'s `google_app_script/` description this session to stop calling it "placeholder... empty" and to reflect the real architecture above — keep that file in sync if this area changes again.

---

## Earlier session (superseded) — CSV-quoting fix in index.html

User created `khutbah/index.html` as a copy of `khutbah/paparan-tajuk.html`
(their action, not mine — I found it already in `git status` as untracked at
session start). The new `index.html` is now the one they want actively
maintained; `paparan-tajuk.html` is explicitly the old file to leave alone.

They reported: Google Sheet title cell is
`"Ibadah Zakat, Wakaf dan Sedekah Teras Pembangunan Ummah"` but the page only
rendered `"Ibadah Zakat`. One symptom, one report, no back-and-forth needed —
I went straight to source, found it immediately:

```js
const rows = text.split("\n").map(row => row.split(","));
```

Google Sheets' CSV export quotes any field containing a comma. A plain
`split(",")` doesn't know about quoting, so it sliced the quoted title field
at the embedded comma — `rows[1][3]` ended up holding just `"Ibadah Zakat`
(with a stray leading quote). Exact match for the symptom, confirmed without
needing to ask the user for more info or guess-and-check.

**Fix applied to `khutbah/index.html` only** (not `paparan-tajuk.html`, per
explicit instruction): added `parseCSVRow(line)` — a small character-by-character
CSV line parser that tracks `inQuotes` state and unescapes `""` → `"`
(RFC 4180 style). Swapped `text.split("\n").map(row => row.split(","))` for
`text.split("\n").filter(line => line.length > 0).map(parseCSVRow)` inside
`fetchSheetData()`. Nothing else touched — `adjustFontSize()`, `scaleToFit()`,
error states, polling interval all untouched, by design.

**Key discovery (don't re-derive)**: the CSV-quoting bug is structural, not a
one-off. Any sheet cell with a comma in it (title, date format with commas,
theme text) will break under naive `split(",")`. This bug almost certainly
still exists in `paparan-tajuk.html` (unfixed, by instruction) and likely also
in `beta-paparan-tajuk.html` if it does its own CSV fetch — not verified.
`parseCSVRow()` in `khutbah/index.html` is the reference fix if this needs
porting elsewhere — small, self-contained, no dependencies.

Mood was brisk and satisfying — clean root-cause diagnosis, no guesswork, no
iteration, plan approved on first pass. Contrast with the battle-worn CSS
energy in `developer.md`.
