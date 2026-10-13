// Plain-node tests for the khutbah 404 fallback chain
// (publish-khutbah-pure.js + api/publish-khutbah.js Step 2) — no framework,
// no live deploy needed for the offline half (same convention as
// api/publish-news.test.js). Run with:
//
//   node api/publish-khutbah.test.js          (offline fixtures only)
//   LIVE=1 node api/publish-khutbah.test.js   (adds read-only live drills vs
//     mufti.pahang.gov.my + api.waktusolat.app — fetches only, writes nothing)
//
// Exits non-zero if any assertion fails.
//
// What each half proves:
//   offline — variants/parents/extraction logic (incl. hijri tiebreak,
//     /en/ skip, same-origin enforcement) without touching the network.
//   live    — L0 primary URL 200s with a real title; a deliberately-broken
//     primary 404s through the alias ladder and is recovered by the
//     parent-walk discovery with the SAME title (layers 1+2 mechanics).
// The handler's try/catch wiring itself is proven by a real run (Monday cron
// or admin Jana & Terbitkan) — the response JSON + khutbah_scrape_ok log
// carry `via: primary | alias-… | discovery:…` showing which layer fired.

const assert = require('assert');

const {
    MALAY_MONTHS,
    parseHijriSlug,
    buildMuftiLink,
    buildWaktusolatUrl,
    buildMuftiLinkVariants,
    buildParentListings,
    extractFridayLink,
    extractDateTitle,
} = require('../api/publish-khutbah.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.then(() => { passed++; console.log(`  ok — ${name}`); })
                .catch(e => { failed++; console.error(`  FAIL — ${name}\n    ${e.message}`); });
        }
        passed++;
        console.log(`  ok — ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL — ${name}`);
        console.error(`    ${e.message}`);
    }
    return Promise.resolve();
}

const FRI = new Date(2026, 9, 2); // Fri Oct 2 2026 (month-boundary case)
const SLUG = '20-rabiulakhir-1448';
const PRIMARY = 'https://mufti.pahang.gov.my/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h';

async function main() {
    console.log('offline:');
    await test('variants: primary + greg + hijri alias', () => {
        assert.deepStrictEqual(buildMuftiLinkVariants(FRI, SLUG), [
            { url: PRIMARY, label: 'primary' },
            { url: 'https://mufti.pahang.gov.my/khutbah/2026/02-october-2026m-20-rabiulakhir-1448h', label: 'alias-greg:oktober->october' },
            { url: 'https://mufti.pahang.gov.my/khutbah/2026/02-oktober-2026m-20-rabiul-akhir-1448h', label: 'alias-hijri:rabiulakhir->rabiul-akhir' },
        ]);
    });
    await test('variants: month with no hijri alias (safar) skips it', () => {
        const v = buildMuftiLinkVariants(new Date(2026, 6, 17), '02-safar-1448');
        assert.strictEqual(v.length, 2); // primary + greg alias only
        assert.strictEqual(v[0].label, 'primary');
    });
    await test('parents: year dir then root', () => {
        assert.deepStrictEqual(buildParentListings(PRIMARY), [
            { url: 'https://mufti.pahang.gov.my/khutbah/2026/', label: 'parent-year' },
            { url: 'https://mufti.pahang.gov.my/khutbah', label: 'parent-root' },
        ]);
    });
    await test('parents: garbage in, empty out', () => {
        assert.deepStrictEqual(buildParentListings('not a url'), []);
    });

    const list = [
        '<a href="/khutbah/2026/25-september-2026m-13-rabiulakhir-1448h">x</a>',
        "<a href='/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h'>y</a>",
        '<a href="https://mufti.pahang.gov.my/en/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h">en</a>',
        '<a href="https://example.com/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h">mirror</a>',
    ].join('');
    await test('extract: exact hit, skips /en/ + off-domain mirror', () => {
        assert.deepStrictEqual(extractFridayLink(list, FRI, 'oktober', SLUG),
            { url: PRIMARY, matchHow: 'exact' });
    });
    await test('extract: renamed greg token falls back to same-day link', () => {
        assert.deepStrictEqual(extractFridayLink(list, FRI, 'okt', SLUG),
            { url: PRIMARY, matchHow: 'day' });
    });
    await test('extract: repeated day number uses hijri tiebreak', () => {
        const multi = '<a href="/khutbah/2026/02-januari-2026m-03-rejab-1447h">a</a>'
            + '<a href="/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h">b</a>';
        assert.deepStrictEqual(extractFridayLink(multi, FRI, 'okt', SLUG),
            { url: PRIMARY, matchHow: 'day+hijri' });
    });
    await test('extract: repeated day, no hijri match takes last', () => {
        const multi = '<a href="/khutbah/2026/02-januari-2026m-03-rejab-1447h">a</a>'
            + '<a href="/khutbah/2026/02-oktober-2026m-20-rabiulakhir-1448h">b</a>';
        assert.deepStrictEqual(extractFridayLink(multi, FRI, 'okt', '99-foo-1400'),
            { url: PRIMARY, matchHow: 'day-last' });
    });
    await test('extract: miss + null input', () => {
        assert.strictEqual(extractFridayLink('<p>tiada</p>', FRI, 'oktober', SLUG), null);
        assert.strictEqual(extractFridayLink(null, FRI, 'oktober', SLUG), null);
    });
    await test('maps: oktober is index 9, slug parses', () => {
        assert.strictEqual(MALAY_MONTHS[9], 'oktober');
        assert.strictEqual(parseHijriSlug('1448-04-20'), SLUG);
        assert.strictEqual(buildWaktusolatUrl(FRI), 'https://api.waktusolat.app/v2/solat/PHG03?year=2026&month=10');
    });

    if (process.env.LIVE) {
        console.log('live (read-only):');
        await test('L0 primary: month-aware hijri resolves + page 200s with title', async () => {
            const wRes = await fetch(buildWaktusolatUrl(FRI));
            assert.strictEqual(wRes.status, 200);
            const prayers = (await wRes.json()).prayers || [];
            const hijri = prayers.find(p => p.day === FRI.getDate()).hijri;
            assert.strictEqual(parseHijriSlug(hijri), SLUG);
            assert.strictEqual(buildMuftiLink(FRI, SLUG), PRIMARY);
            const mRes = await fetch(PRIMARY);
            assert.strictEqual(mRes.status, 200);
            const { titleText, dateText } = extractDateTitle(await mRes.text());
            assert.ok(titleText && dateText, 'expected title + date on live page');
            process.env.LIVE_TITLE = titleText;
        });
        await test('L1+L2 drill: broken primary 404s, aliases miss, parent walk recovers same title', async () => {
            const broken = PRIMARY.replace('-oktober-', '-BROKEN-').replace('-rabiulakhir-', '-99-broken-');
            assert.strictEqual((await fetch(broken)).status, 404);
            for (const v of buildMuftiLinkVariants(FRI, '99-broken-1448').slice(1)) {
                assert.strictEqual((await fetch(v.url)).status, 404, `${v.label} should 404`);
            }
            const [yearPage] = buildParentListings(PRIMARY);
            const listHtml = await (await fetch(yearPage.url)).text();
            const found = extractFridayLink(listHtml, FRI, 'BROKEN', SLUG);
            assert.ok(found, 'discovery should find the Friday link');
            assert.strictEqual(found.url, PRIMARY);
            const { titleText } = extractDateTitle(await (await fetch(found.url)).text());
            assert.strictEqual(titleText, process.env.LIVE_TITLE, 'recovered page must carry the same title');
        });
    } else {
        console.log('(live drills skipped — re-run with LIVE=1 to hit mufti + waktusolat read-only)');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main();
