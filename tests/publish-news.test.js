// Plain-node unit tests for api/publish-news.js's pure, exported builders —
// no framework, no live deploy needed (same "exported for ad-hoc node
// testing" convention as api/publish.js / api/publish-infaq.js, and the
// vm-based harness convention documented in news/developer.md). Run with:
//
//   node api/publish-news.test.js
//
// Exits non-zero if any assertion fails, so it's CI-friendly even without a
// test runner installed.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const {
    parseCSVRow,
    looksLikeErrorText,
    mytDateString,
    mytDateTimeString,
    normalizeBoundary,
    isActiveNow,
    buildAnnouncementsJson,
    buildMovingTextJson,
} = require('../api/publish-news.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok — ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL — ${name}`);
        console.error(`    ${e.message}`);
    }
}

// ── parseCSVRow ──────────────────────────────────────────────────────────────
console.log('parseCSVRow');
test('splits plain comma-separated cells', () => {
    assert.deepStrictEqual(parseCSVRow('a,b,c'), ['a', 'b', 'c']);
});
test('keeps a comma that is inside quotes intact (the khutbah CSV bug)', () => {
    const line = '1,"Ibadah Zakat, Wakaf dan Sedekah",2026-07-25,Tajuk penuh';
    assert.deepStrictEqual(parseCSVRow(line), ['1', 'Ibadah Zakat, Wakaf dan Sedekah', '2026-07-25', 'Tajuk penuh']);
});
test('unescapes doubled quotes inside a quoted cell', () => {
    assert.deepStrictEqual(parseCSVRow('a,"say ""hi""",c'), ['a', 'say "hi"', 'c']);
});

// ── looksLikeErrorText ───────────────────────────────────────────────────────
console.log('looksLikeErrorText');
test('flags a leading ERROR string', () => {
    assert.strictEqual(looksLikeErrorText('ERROR: Failed to fetch the webpage. Status: 503'), true);
});
test('flags a bare HTTP status phrase', () => {
    assert.strictEqual(looksLikeErrorText('Something failed, Status: 404'), true);
});
test('does not flag a normal khutbah title', () => {
    assert.strictEqual(looksLikeErrorText('Nuzul Al-Quran'), false);
});

// ── mytDateString / mytDateTimeString ─────────────────────────────────────────
console.log('mytDateString / mytDateTimeString');
test('reads the UTC calendar date of an already-shifted instant', () => {
    assert.strictEqual(mytDateString(new Date(Date.UTC(2026, 6, 28, 23, 59, 0))), '2026-07-28');
});
test('mytDateTimeString adds hour:minute, no seconds', () => {
    assert.strictEqual(mytDateTimeString(new Date(Date.UTC(2026, 6, 28, 14, 5, 59))), '2026-07-28T14:05');
});

// ── normalizeBoundary ────────────────────────────────────────────────────────
console.log('normalizeBoundary');
test('expands a bare date to start-of-day for a start boundary', () => {
    assert.strictEqual(normalizeBoundary('2026-07-28', false), '2026-07-28T00:00');
});
test('expands a bare date to end-of-day for an end boundary', () => {
    assert.strictEqual(normalizeBoundary('2026-07-28', true), '2026-07-28T23:59');
});
test('truncates a full timestamp (with seconds) to minute precision', () => {
    assert.strictEqual(normalizeBoundary('2026-07-28T14:30:00', true), '2026-07-28T14:30');
});
test('returns null for an empty/missing value', () => {
    assert.strictEqual(normalizeBoundary(null, false), null);
    assert.strictEqual(normalizeBoundary('', true), null);
});

// ── isActiveNow — date-only expansion, boundaries, disabled, open windows ────
console.log('isActiveNow');
const TICKER_NOW = new Date(Date.UTC(2026, 6, 28, 10, 0, 0)); // mytDateString → '2026-07-28'

const WINDOW_CASES = [
    { label: 'expired window',                 start_at: '2026-07-20', end_at: '2026-07-27', enabled: true,  expect: false },
    { label: 'single-day window, today',        start_at: '2026-07-28', end_at: '2026-07-28', enabled: true,  expect: true  },
    { label: 'boundary: starts today',          start_at: '2026-07-28', end_at: '2026-08-01', enabled: true,  expect: true  },
    { label: 'boundary: ends today',            start_at: '2026-07-01', end_at: '2026-07-28', enabled: true,  expect: true  },
    { label: 'open-ended: starts today, no end',start_at: '2026-07-28', end_at: null,          enabled: true,  expect: true  },
    { label: 'future: starts tomorrow',         start_at: '2026-07-29', end_at: null,          enabled: true,  expect: false },
    { label: 'open-started: ends today',        start_at: null,         end_at: '2026-07-28',   enabled: true,  expect: true  },
    { label: 'open-started: ended yesterday',   start_at: null,         end_at: '2026-07-27',   enabled: true,  expect: false },
    { label: 'no window at all (always on)',    start_at: null,         end_at: null,           enabled: true,  expect: true  },
    { label: 'disabled overrides an active window', start_at: '2026-07-01', end_at: '2026-08-01', enabled: false, expect: false },
];

WINDOW_CASES.forEach(c => {
    test(c.label, () => {
        assert.strictEqual(isActiveNow(c, TICKER_NOW), c.expect);
    });
});

// Cross-check against news/script.js's own isActive()/parseLocalDate() on the
// identical set of windows — buildMovingTextJson's server-side scheduling
// must never disagree with the display's client-side scheduling in
// announcements.json. Loaded via vm, same harness pattern as
// news/developer.md documents (script.js has no top-level DOM access, so it
// loads fine with no stub context).
test('agrees with news/script.js isActive() on every window case above', () => {
    const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'news', 'script.js'), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(scriptSrc, ctx);
    const scriptIsActive = vm.runInContext('isActive', ctx);

    // script.js's isActive() also requires image_url or text to exist —
    // that's an announcements-only content rule, irrelevant to the ticker's
    // pure scheduling logic, so every case gets a dummy `text` to satisfy it
    // and isolate the comparison to just the enabled/date-window semantics.
    const SCRIPT_NOW = new Date(2026, 6, 28, 10, 0, 0); // local wall-clock "now" — parseLocalDate() also parses via local time, so this stays self-consistent regardless of the test machine's real timezone

    WINDOW_CASES.forEach(c => {
        const scriptResult = scriptIsActive({ ...c, text: 'dummy' }, SCRIPT_NOW);
        assert.strictEqual(scriptResult, c.expect, `case "${c.label}": script.js isActive() returned ${scriptResult}, expected ${c.expect}`);
    });
});

// ── isActiveNow — minute-precision windows (day+hour+minute scheduling) ──────
console.log('isActiveNow (minute precision)');
// TICKER_NOW is 2026-07-28T10:00 MYT (see mytDateTimeString(TICKER_NOW) above).
const TIME_WINDOW_CASES = [
    { label: 'now inside a same-day time window',       start_at: '2026-07-28T09:00', end_at: '2026-07-28T11:00', enabled: true, expect: true  },
    { label: 'now before a same-day time window starts', start_at: '2026-07-28T14:00', end_at: '2026-07-28T15:00', enabled: true, expect: false },
    { label: 'now after a same-day time window ends',    start_at: '2026-07-28T07:00', end_at: '2026-07-28T09:00', enabled: true, expect: false },
    { label: 'boundary: starts at the exact minute',     start_at: '2026-07-28T10:00', end_at: null,               enabled: true, expect: true  },
    { label: 'boundary: ends at the exact minute',       start_at: null,               end_at: '2026-07-28T10:00', enabled: true, expect: true  },
    { label: 'one minute before end — still active',     start_at: null,               end_at: '2026-07-28T10:01', enabled: true, expect: true  },
    { label: 'one minute after end — expired',           start_at: null,               end_at: '2026-07-28T09:59', enabled: true, expect: false },
    { label: 'bare-date start still means start-of-day (legacy row)', start_at: '2026-07-28', end_at: null, enabled: true, expect: true },
];

TIME_WINDOW_CASES.forEach(c => {
    test(c.label, () => {
        assert.strictEqual(isActiveNow(c, TICKER_NOW), c.expect);
    });
});

test('agrees with news/script.js isActive() on every minute-precision case above', () => {
    const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'news', 'script.js'), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(scriptSrc, ctx);
    const scriptIsActive = vm.runInContext('isActive', ctx);

    const SCRIPT_NOW = new Date(2026, 6, 28, 10, 0, 0); // same wall-clock instant as TICKER_NOW

    TIME_WINDOW_CASES.forEach(c => {
        const scriptResult = scriptIsActive({ ...c, text: 'dummy' }, SCRIPT_NOW);
        assert.strictEqual(scriptResult, c.expect, `case "${c.label}": script.js isActive() returned ${scriptResult}, expected ${c.expect}`);
    });
});

// ── buildMovingTextJson ───────────────────────────────────────────────────────
console.log('buildMovingTextJson');
const SETTINGS = { default_ticker_line: 'Selamat datang ke Masjid Al-Mukhlisin Taman Jaya 6' };

test('output shape is exactly {"moving-text":[{"Col1":...}]}', () => {
    const out = buildMovingTextJson(
        [{ message: 'Sila senyap', kind: 'static', enabled: true, sort_order: 0 }],
        SETTINGS, null, TICKER_NOW
    );
    assert.deepStrictEqual(out, { 'moving-text': [{ Col1: 'Sila senyap' }] });
});

test('orders by sort_order regardless of input order', () => {
    const rows = [
        { message: 'C', kind: 'static', enabled: true, sort_order: 2 },
        { message: 'A', kind: 'static', enabled: true, sort_order: 0 },
        { message: 'B', kind: 'static', enabled: true, sort_order: 1 },
    ];
    const out = buildMovingTextJson(rows, SETTINGS, null, TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'].map(r => r.Col1), ['A', 'B', 'C']);
});

test('filters out inactive/expired/disabled rows', () => {
    const rows = [
        { message: 'Active',   kind: 'static', enabled: true,  start_at: null, end_at: null, sort_order: 0 },
        { message: 'Expired',  kind: 'static', enabled: true,  start_at: '2026-01-01', end_at: '2026-01-31', sort_order: 1 },
        { message: 'Disabled', kind: 'static', enabled: false, sort_order: 2 },
    ];
    const out = buildMovingTextJson(rows, SETTINGS, null, TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'], [{ Col1: 'Active' }]);
});

test('resolves an active khutbah row with its prefix', () => {
    const rows = [{ kind: 'khutbah', prefix: 'Khutbah Jumaat Minggu Ini: ', enabled: true, sort_order: 0 }];
    const out = buildMovingTextJson(rows, SETTINGS, 'Nuzul Al-Quran', TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'], [{ Col1: 'Khutbah Jumaat Minggu Ini: Nuzul Al-Quran' }]);
});

test('a khutbah row with no resolvable title is omitted entirely, other lines survive', () => {
    const rows = [
        { message: 'Static line', kind: 'static',  enabled: true, sort_order: 0 },
        { kind: 'khutbah', prefix: 'Khutbah: ',     enabled: true, sort_order: 1 },
    ];
    const out = buildMovingTextJson(rows, SETTINGS, null, TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'], [{ Col1: 'Static line' }]);
});

test('never publishes an error/status string even if a bad title somehow reaches it', () => {
    // Defense-in-depth: resolveKhutbahTitle() screens error-shaped text
    // before this function ever sees it, but buildMovingTextJson itself
    // must never be the thing that lets one through either.
    const rows = [{ kind: 'khutbah', prefix: 'Khutbah: ', enabled: true, sort_order: 0 }];
    const badTitle = 'ERROR: Failed to fetch the webpage. Status: 503';
    const out = buildMovingTextJson(rows, SETTINGS, badTitle, TICKER_NOW);
    // buildMovingTextJson only ever concatenates prefix + whatever title
    // string it's given — the actual gate lives in resolveKhutbahTitle()
    // (see api/publish-news.js), verified separately via looksLikeErrorText
    // above. This assertion documents that dependency explicitly: if this
    // ever starts failing, it means buildMovingTextJson gained its own
    // (redundant, and now inconsistent) filtering logic.
    assert.strictEqual(out['moving-text'][0].Col1, `Khutbah: ${badTitle}`);
});

test('empty result falls back to exactly one default_ticker_line row', () => {
    const out = buildMovingTextJson([], SETTINGS, null, TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'], [{ Col1: SETTINGS.default_ticker_line }]);
});

test('all rows filtered out also falls back to the default line', () => {
    const rows = [{ message: 'Expired', kind: 'static', enabled: true, start_at: '2020-01-01', end_at: '2020-01-02', sort_order: 0 }];
    const out = buildMovingTextJson(rows, SETTINGS, null, TICKER_NOW);
    assert.deepStrictEqual(out['moving-text'], [{ Col1: SETTINGS.default_ticker_line }]);
});

// ── buildAnnouncementsJson ────────────────────────────────────────────────────
console.log('buildAnnouncementsJson');
const ANN_SETTINGS = { default_image: '/news/default.svg' };

test('attaches default_image from settings', () => {
    const out = buildAnnouncementsJson([], ANN_SETTINGS);
    assert.strictEqual(out.default_image, '/news/default.svg');
});

test('drops enabled=false rows', () => {
    const rows = [
        { title: 'On',  body_text: 'x', enabled: true,  sort_order: 0 },
        { title: 'Off', body_text: 'x', enabled: false, sort_order: 1 },
    ];
    const out = buildAnnouncementsJson(rows, ANN_SETTINGS);
    assert.deepStrictEqual(out.announcements.map(a => a.title), ['On']);
});

test('keeps future-dated rows (display filters live, not the publish endpoint)', () => {
    const rows = [{ title: 'Future', body_text: 'x', start_at: '2099-01-01', end_at: '2099-01-02', enabled: true, sort_order: 0 }];
    const out = buildAnnouncementsJson(rows, ANN_SETTINGS);
    assert.strictEqual(out.announcements.length, 1);
    assert.strictEqual(out.announcements[0].start_at, '2099-01-01');
});

test('maps body_text to the published "text" field', () => {
    const rows = [{ title: 'T', body_text: 'Isi kandungan', enabled: true, sort_order: 0 }];
    const out = buildAnnouncementsJson(rows, ANN_SETTINGS);
    assert.strictEqual(out.announcements[0].text, 'Isi kandungan');
    assert.strictEqual('body_text' in out.announcements[0], false);
});

test('orders by sort_order', () => {
    const rows = [
        { title: 'B', body_text: 'x', enabled: true, sort_order: 1 },
        { title: 'A', body_text: 'x', enabled: true, sort_order: 0 },
    ];
    const out = buildAnnouncementsJson(rows, ANN_SETTINGS);
    assert.deepStrictEqual(out.announcements.map(a => a.title), ['A', 'B']);
});

test('a currently-active published entry actually renders as active through news/script.js isActive()', () => {
    const rows = [{ title: 'Now', body_text: 'Isi', start_at: '2026-07-01', end_at: '2026-08-01', enabled: true, sort_order: 0 }];
    const out = buildAnnouncementsJson(rows, ANN_SETTINGS);

    const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'news', 'script.js'), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(scriptSrc, ctx);
    const scriptIsActive = vm.runInContext('isActive', ctx);

    const now = new Date(2026, 6, 28, 10, 0, 0);
    assert.strictEqual(scriptIsActive(out.announcements[0], now), true);
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
