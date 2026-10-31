// =================================================================
// TEST.JS — dynamic duration test for news display (Xibo)
// Isolated copy of /news/script.js + per-type durations:
//   text  -> 8s, image -> 12s, combo -> 15s
// Slideshow mode plays ALL active slides 1..n, then sends ONE
// XiboPageRendered() signal at the end of the full cycle.
// Total = sum of active slide durations (dynamic, recomputed each cycle).
// Single mode (?type= / ?ann=) shows one slide and signals once.
// Outside Xibo (plain browser) the signal is only logged + shown in HUD.
// Isolated: reads /news/test/fixture.json, not the live announcements.json.
// =================================================================

const TEST_JSON_URL = '/news/test/fixture.json';
const TEST_FALLBACK_DEFAULT_IMAGE = '/news/default.svg';
const TEST_FADE_MS = 700; // keep in sync with .slide-layer transition

// Per-type (a): text 8s, image 12s, combo 15s
const TEST_DURATIONS = {
    text: 8000,
    image: 12000,
    combo: 15000,
};

let testData = null;
let testActiveList = [];
let testRotationIndex = 0;
let testCurrentKey = null;
let testVisibleLayerIdx = 0;
let testSlideTimer = null;
let testCountdownTimer = null;
let testSlideDeadline = 0;
let testCycleTotal = 0;
let testMode = 'slideshow'; // slideshow (full cycle, one signal) | single (one slide, one signal)
let testFilterType = null;  // null | 'text' | 'image' | 'combo'
let testPinnedAnnIndex = null; // ?ann=N (1-based, fixture order)
let testDurationOverride = null;

function testParseLocalDate(value, isEnd) {
    if (!value) return null;
    let str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        str += isEnd ? 'T23:59:59' : 'T00:00:00';
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function testIsActive(item, now) {
    if (!item || item.enabled === false) return false;
    if (!item.image_url && !item.text) return false;
    const start = testParseLocalDate(item.start_at, false);
    const end = testParseLocalDate(item.end_at, true);
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
}

function testHasCaption(item) {
    return Boolean(item.image_url && (item.text || item.heading));
}

function testSlideKind(item) {
    if (testHasCaption(item)) return 'combo';
    if (item.text) return 'text';
    return 'image';
}

function testItemKey(item) {
    if (testHasCaption(item)) {
        return `combo:${item.image_url}|${item.heading || ''}|${item.text || ''}`;
    }
    return item.text
        ? `text:${item.heading || ''}|${item.text}`
        : `img:${item.image_url}`;
}

// Per-type duration. ?duration=N (seconds) overrides everything — for fallback testing.
function getDurationForItem(item) {
    if (testDurationOverride !== null) return testDurationOverride;
    const kind = testSlideKind(item);
    return TEST_DURATIONS[kind] ?? 10000;
}

// Dynamic total: sum over the frozen active list of the current cycle.
function getCycleTotal() {
    return testActiveList.reduce((sum, item) => sum + getDurationForItem(item), 0);
}

function testHud(ids) {
    for (const [id, val] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }
}

function testDetectXibo() {
    if (typeof XiboPageRendered === 'function') return 'XiboPageRendered()';
    if (window.xibo && typeof window.xibo.pageRendered === 'function') return 'window.xibo.pageRendered()';
    return null;
}

// Signal to Xibo + HUD display so it can be verified without real Xibo.
function notifyXibo(key, durationMs) {
    const api = testDetectXibo();
    const hudXibo = document.getElementById('hud-xibo');
    const hudSignal = document.getElementById('hud-signal');
    if (api === 'XiboPageRendered()') {
        try { XiboPageRendered(); } catch (e) { console.error('XiboPageRendered failed:', e); }
        if (hudXibo) hudXibo.textContent = 'SIGNAL sent (XiboPageRendered)';
        console.log(`[news/test] XiboPageRendered() sent key=${key} after ${durationMs}ms`);
    } else if (api === 'window.xibo.pageRendered()') {
        try { window.xibo.pageRendered(); } catch (e) { console.error('xibo.pageRendered failed:', e); }
        if (hudXibo) hudXibo.textContent = 'SIGNAL sent (xibo.pageRendered)';
        console.log(`[news/test] window.xibo.pageRendered() sent key=${key} after ${durationMs}ms`);
    } else {
        if (hudXibo) hudXibo.textContent = 'not in Xibo — logged only';
        console.log(`[news/test] (not Xibo) simulated SIGNAL key=${key} after ${durationMs}ms`);
    }
    if (hudSignal) hudSignal.classList.add('fired');
}

function testClearTimers() {
    if (testSlideTimer) { clearTimeout(testSlideTimer); testSlideTimer = null; }
    if (testCountdownTimer) { clearInterval(testCountdownTimer); testCountdownTimer = null; }
    const hudSignal = document.getElementById('hud-signal');
    if (hudSignal) hudSignal.classList.remove('fired');
}

function testModeLabel() {
    if (testMode === 'single') {
        if (testPinnedAnnIndex !== null) return `single:ann=${testPinnedAnnIndex}`;
        if (testFilterType) return `single:${testFilterType}`;
        return 'single';
    }
    return 'slideshow-cycle';
}

// Remaining cycle time = current slide remaining + sum of later slides in this cycle.
function testCycleRemaining() {
    const n = testActiveList.length;
    if (n === 0) return 0;
    const idx = testRotationIndex % n;
    let later = 0;
    for (let j = idx + 1; j < n; j++) later += getDurationForItem(testActiveList[j]);
    return Math.max(0, testSlideDeadline - Date.now()) + later;
}

// Arms the timer AFTER the slide is visible (text: immediately; image/combo: after onload).
// Single mode: signal when this slide ends.
// Slideshow mode: advance internally with NO signal; only the last slide signals the cycle end.
function testArmSlide(item, key) {
    testClearTimers();
    const durationMs = getDurationForItem(item);
    const kind = testSlideKind(item);
    testSlideDeadline = Date.now() + durationMs;
    const n = testActiveList.length;
    const idx = n === 0 ? 0 : testRotationIndex % n;

    if (testMode === 'single') {
        testHud({
            'hud-type': kind,
            'hud-duration': `${(durationMs / 1000).toFixed(0)}s (${kind})`,
            'hud-slide': '1/1',
            'hud-countdown': `${(durationMs / 1000).toFixed(1)}s`,
            'hud-cycle': `total ${(durationMs / 1000).toFixed(0)}s`,
            'hud-mode': testModeLabel(),
        });
    } else {
        testHud({
            'hud-type': kind,
            'hud-duration': `${(durationMs / 1000).toFixed(0)}s (${kind})`,
            'hud-slide': `${idx + 1}/${n}`,
            'hud-countdown': `${(durationMs / 1000).toFixed(1)}s`,
            'hud-cycle': `total ${(testCycleTotal / 1000).toFixed(0)}s (${n} slides)`,
            'hud-mode': testModeLabel(),
        });
    }
    if (!testDetectXibo()) {
        const hudXibo = document.getElementById('hud-xibo');
        if (hudXibo) hudXibo.textContent = 'not in Xibo — logged only';
    }
    testCountdownTimer = setInterval(() => {
        const slideLeft = Math.max(0, testSlideDeadline - Date.now());
        const slideEl = document.getElementById('hud-countdown');
        if (slideEl) slideEl.textContent = `${(slideLeft / 1000).toFixed(1)}s`;
        if (testMode !== 'single') {
            const cycleEl = document.getElementById('hud-cycle');
            if (cycleEl) cycleEl.textContent = `total ${(testCycleTotal / 1000).toFixed(0)}s (${n} slides) | left ${(testCycleRemaining() / 1000).toFixed(1)}s`;
        }
    }, 100);

    testSlideTimer = setTimeout(() => {
        if (testCountdownTimer) { clearInterval(testCountdownTimer); testCountdownTimer = null; }
        if (testMode === 'single') {
            const el = document.getElementById('hud-countdown');
            if (el) el.textContent = '0.0s — SIGNAL';
            notifyXibo(key, durationMs);
            // Single: stay here after SIGNAL. Xibo cuts to the next widget.
            return;
        }
        // Slideshow cycle: last slide ends the cycle with ONE signal.
        const isLast = (testRotationIndex % testActiveList.length) === testActiveList.length - 1;
        if (isLast) {
            const el = document.getElementById('hud-countdown');
            if (el) el.textContent = '0.0s — CYCLE SIGNAL';
            notifyXibo(`cycle:${testActiveList.length}slides`, testCycleTotal);
            // Browser preview loops; in real Xibo, Xibo cuts away on SIGNAL so this restart is never seen.
            testSlideTimer = setTimeout(() => {
                testStartCycle();
            }, 1500);
        } else {
            testRotationIndex += 1;
            testRender();
        }
    }, durationMs);
}

function testShowMessageFallback() {
    testClearTimers();
    document.getElementById('layer-a').classList.remove('visible');
    document.getElementById('layer-b').classList.remove('visible');
    document.getElementById('message').style.display = 'block';
    testHud({ 'hud-type': 'fallback', 'hud-duration': '-', 'hud-slide': '-', 'hud-countdown': '-', 'hud-cycle': '-' });
}

function testSwapTo(el) {
    const layers = [document.getElementById('layer-a'), document.getElementById('layer-b')];
    const prev = layers[testVisibleLayerIdx];
    const next = layers[1 - testVisibleLayerIdx];
    testVisibleLayerIdx = 1 - testVisibleLayerIdx;

    document.getElementById('message').style.display = 'none';

    clearTimeout(testSwapTo._hidePrevTimer);
    next.style.transition = 'none';
    next.classList.remove('visible');
    next.replaceChildren(el);
    void next.offsetHeight;
    next.style.transition = '';

    next.style.zIndex = '2';
    prev.style.zIndex = '1';

    if (!testSwapTo._firstDone) {
        testSwapTo._firstDone = true;
        next.style.transition = 'none';
        next.classList.add('visible');
        void next.offsetHeight;
        next.style.transition = '';
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            next.classList.add('visible');
        });
    });
    testSwapTo._hidePrevTimer = setTimeout(() => {
        prev.classList.remove('visible');
    }, TEST_FADE_MS + 100);
}

function testBuildTextEl(item) {
    const slide = document.createElement('div');
    slide.className = 'text-slide';
    if (item.heading) {
        const heading = document.createElement('div');
        heading.className = 'text-heading';
        heading.textContent = item.heading;
        slide.appendChild(heading);
    }
    if (item.text) {
        const body = document.createElement('div');
        body.className = 'text-body';
        body.textContent = item.text;
        slide.appendChild(body);
    }
    return slide;
}

function testShowTextSlide(item) {
    const key = testItemKey(item);
    if (key === testCurrentKey) { testArmSlide(item, key); return; }
    testCurrentKey = key;
    testSwapTo(testBuildTextEl(item));
    testArmSlide(item, key);
}

function testShowComboSlide(item) {
    const key = testItemKey(item);
    if (key === testCurrentKey) { testArmSlide(item, key); return; }
    testCurrentKey = key;

    const wrap = document.createElement('div');
    wrap.className = 'combo-slide';

    const img = document.createElement('img');
    img.alt = 'Pengumuman';
    // Count duration only after the image is ready — avoids Xibo cutting mid-load.
    img.onload = () => {
        if (testCurrentKey !== key) return;
        testSwapTo(wrap);
        testArmSlide(item, key);
    };
    img.onerror = () => {
        console.error('Failed to load image:', item.image_url);
        if (testCurrentKey !== key) return;
        testSwapTo(testBuildTextEl(item));
        testArmSlide(item, key);
    };
    wrap.appendChild(img);

    const caption = document.createElement('div');
    caption.className = 'caption-bar';
    if (item.heading) {
        const heading = document.createElement('div');
        heading.className = 'caption-heading';
        heading.textContent = item.heading;
        caption.appendChild(heading);
    }
    if (item.text) {
        const body = document.createElement('div');
        body.className = 'caption-body';
        body.textContent = item.text;
        caption.appendChild(body);
    }
    wrap.appendChild(caption);

    img.src = item.image_url;
}

function testSetImage(src) {
    if (!src) { testShowMessageFallback(); return; }
    const key = `img:${src}`;
    const fakeItem = { image_url: src };
    if (key === testCurrentKey) { testArmSlide(fakeItem, key); return; }
    testCurrentKey = key;

    const img = document.createElement('img');
    img.alt = 'Pengumuman';
    img.onload = () => {
        if (testCurrentKey !== key) return;
        testSwapTo(img);
        testArmSlide(fakeItem, key);
    };
    img.onerror = () => {
        console.error('Failed to load image:', src);
        if (testCurrentKey !== key) return;
        testCurrentKey = null;
        if (src !== TEST_FALLBACK_DEFAULT_IMAGE) {
            testSetImage(TEST_FALLBACK_DEFAULT_IMAGE);
        } else {
            testShowMessageFallback();
        }
    };
    img.src = src;
}

function testDefaultImageUrl() {
    return testData?.default_image || TEST_FALLBACK_DEFAULT_IMAGE;
}

function testRender() {
    if (testActiveList.length === 0) {
        testSetImage(testDefaultImageUrl());
        return;
    }
    const item = testActiveList[testRotationIndex % testActiveList.length];
    if (testHasCaption(item)) {
        testShowComboSlide(item);
    } else if (item.text) {
        testShowTextSlide(item);
    } else {
        testSetImage(item.image_url);
    }
}

// Freeze the active list + total for one full cycle. Mid-cycle publishes
// are ignored until the next cycle starts (avoids cutting the cycle short).
function testStartCycle() {
    const now = new Date();
    const list = Array.isArray(testData?.announcements) ? testData.announcements : [];
    testActiveList = list.filter(item => testIsActive(item, now));
    testRotationIndex = 0;
    testCycleTotal = getCycleTotal();
    testRender();
}

async function testFetchData() {
    const response = await fetch(`${TEST_JSON_URL}?v=${new Date().getTime()}`);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    return response.json();
}

async function initNewsTestDisplay() {
    const params = new URLSearchParams(window.location.search);
    const typeParam = (params.get('type') || '').toLowerCase();
    testFilterType = ['text', 'image', 'combo'].includes(typeParam) ? typeParam : null;
    const annParam = parseInt(params.get('ann'), 10);
    testPinnedAnnIndex = Number.isInteger(annParam) && annParam >= 1 ? annParam : null;
    const durParam = parseFloat(params.get('duration'));
    testDurationOverride = Number.isFinite(durParam) && durParam > 0 ? Math.round(durParam * 1000) : null;
    // ?ann=N or ?type=X → single mode (one slide, one SIGNAL per page load).
    // Otherwise full-cycle slideshow (all active slides, ONE signal at cycle end).
    testMode = (testFilterType || testPinnedAnnIndex !== null) ? 'single' : 'slideshow';

    try {
        testData = await testFetchData();
    } catch (error) {
        console.error('Failed to load test data:', error);
        testData = null;
    }

    if (testMode === 'single') {
        const now = new Date();
        const list = Array.isArray(testData?.announcements) ? testData.announcements : [];
        let active;
        if (testPinnedAnnIndex !== null) {
            const item = list[testPinnedAnnIndex - 1];
            active = item && testIsActive(item, now) ? [item] : [];
        } else {
            active = list.filter(item => testIsActive(item, now));
            if (testFilterType) {
                active = active.filter(item => testSlideKind(item) === testFilterType);
            }
        }
        testActiveList = active;
        testRotationIndex = 0;
        testCycleTotal = getCycleTotal();
        testRender();
        return;
    }

    testStartCycle();
}
