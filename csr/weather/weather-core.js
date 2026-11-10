// =====================================================================
// weather-core.js — logic for csr/weather/index.html (interactive map)
//
// As of 2026-08-10 this file is used ONLY by /csr/weather/index.html —
// csr/weather/paparan/ was forked off to its own independent copy at
// csr/weather/paparan/weather-core.js so this one is free to be moved/
// repurposed for a separate, larger weather project without breaking
// the signage page. If you're editing MET-parsing logic, check whether
// csr/weather/paparan/weather-core.js needs the same fix — it will NOT
// pick up changes made here anymore, the two are independent.
//
// Generalized 2026-08-10 to support any Malaysian state, not just
// Pahang: every function that used to hardcode "Pahang" now takes a
// `cfg` argument — one entry from data/states.json (see index.html's
// boot sequence for how `cfg` is resolved from ?state=). The shape of
// `cfg` is { displayName, apiName, stateCode, districts, aliases,
// center, zoom }. This generalization does NOT extend to
// csr/weather/paparan/weather-core.js — that fork is untouched and
// still Pahang-only by design (see its own header comment).
//
// Loaded (classic script, no modules — repo has no build tools) via
// <script src="/csr/weather/weather-core.js"> — ABSOLUTE path, the
// Vercel cleanUrls lesson: relative paths resolve one level too high on
// slash-less directory URLs.
//
// Everything here is DOM-free and Leaflet-free on purpose: it's the
// fetch/parse/severity layer. Page-specific rendering (Leaflet styles
// wiring, banners, cards) stays in index.html's own inline script.
//
// Verified by scratchpad harness test-rain-tiers.js (Node vm, loads this
// file directly) — as of the 2026-08-10 fork, that harness may need
// updating if it also exercised paparan's inline script against this file.
// =====================================================================

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const STATES_JSON_URL = '/csr/weather/data/states.json';
const GEOJSON_URL = 'https://raw.githubusercontent.com/mptwaktusolat/jakim.geojson/refs/heads/master/malaysia.district.geojson';
// Vercel proxy for MET's continuous-rain dataset (see api/weather-warning.js
// — the METToken must stay server-side). 404s under Live Server /
// python -m http.server (no /api routes locally, documented repo-wide
// limitation) — pages just show no rain data locally; use
// ?testWarning=rain to exercise the rain path without the proxy.
const RAIN_PROXY_URL = '/api/weather-warning';
const REFRESH_MS = 3 * 60 * 1000; // warning-poll interval: 3 minutes

// Builds the data.gov.my warning-list URL for the active state. Always
// via URLSearchParams (never string concatenation) — cfg.apiName comes
// only from a validated states.json entry, never straight from the
// ?state= query string, but this keeps it safe even if that ever changes.
//
// Nationwide mode (cfg.apiName === null, the "malaysia" states.json entry)
// omits the contains= filter entirely instead of looping this request once
// per state — the endpoint just returns every currently-active bulletin
// unfiltered, which computeWarningStateNationwide() then slices per-state
// itself (see that function). limit is raised accordingly since we now
// need EVERY active bulletin, not just the ~20 most recent ones mentioning
// one state.
function buildWarningApiUrl(cfg) {
  const params = cfg.apiName
    ? new URLSearchParams({ contains: `${cfg.apiName}@text_en`, limit: '20' })
    : new URLSearchParams({ limit: '100' });
  return `https://api.data.gov.my/weather/warning?${params.toString()}`;
}

// Escapes regex metacharacters in a state/district name before it's
// spliced into a RegExp — defensive, since these ultimately trace back
// to states.json content.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------
// Severity tiers. MET's hujan berterusan ladder is Waspada (yellow) <
// Buruk (orange) < Bahaya (red). 'amaran' is the untiered Ribut Petir/
// Hujan Lebat blue from data.gov.my bulletins (their headings use
// different wording, not this three-step ladder), ranked BELOW Waspada
// so any Hujan Berterusan tier keeps its own colour even if
// a thunderstorm warning also covers the same district — highest rank wins per
// district. Colours match MET Malaysia's own warning-map palette.
// ---------------------------------------------------------------------
const TIER_RANK = { amaran: 1, waspada: 2, buruk: 3, bahaya: 4 };
const TIER_COLORS = {
  waspada: { fill: '#fdfe00', border: '#000000' },
  amaran: { fill: '#2516d2', border: '#000000' },
  buruk: { fill: '#fea402', border: '#000000' },
  bahaya: { fill: '#fa0101', border: '#000000' },
};
const TIER_LABEL = { waspada: 'Waspada', amaran: 'Amaran', buruk: 'Buruk', bahaya: 'Bahaya' };

// Leaflet style objects for district polygons — pure data, safe here.
const defaultStyle = {
  fillColor: "#ffffff",
  weight: 2,
  opacity: 1,
  color: '#000000',
  fillOpacity: 0.6
};

function districtWarningStyle(tier) {
  const c = TIER_COLORS[tier] || TIER_COLORS.amaran;
  return { fillColor: c.fill, weight: 3, opacity: 1, color: c.border, fillOpacity: 0.85 };
}

// Whole-state advisory — same tier hue and fill weight as a confirmed
// district hit (by request; this used to render washed out at 0.35
// fillOpacity to signal "MET was vague about which district", but the
// site now shows state-wide warnings just as solidly as district ones).
function stateWarningStyle(tier) {
  return districtWarningStyle(tier);
}

// ---------------------------------------------------------------------
// states.json loader — fetched once at boot, before anything else runs.
// Validates each entry has the fields every function below relies on;
// entries missing a required field are dropped (logged), not fatal on
// their own. A total fetch/parse failure IS fatal — the caller shows a
// page-level error rather than booting with no states at all.
// ---------------------------------------------------------------------
const REQUIRED_STATE_FIELDS = ['displayName', 'apiName', 'stateCode', 'districts'];

async function loadStateConfig() {
  const resp = await fetchWithTimeout(STATES_JSON_URL, 8000);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const raw = await resp.json();
  const valid = {};
  Object.entries(raw).forEach(([key, entry]) => {
    const missing = REQUIRED_STATE_FIELDS.filter(f => entry[f] === undefined);
    if (missing.length) {
      console.warn(`[weather] states.json entry "${key}" missing required field(s), skipped:`, missing.join(', '));
      return;
    }
    valid[key] = { aliases: {}, center: null, zoom: null, ...entry };
  });
  if (Object.keys(valid).length === 0) throw new Error('states.json contained no valid entries');
  return valid;
}

// ---------------------------------------------------------------------
// Fetch helper — never let a hung API block rendering
// (same pattern as kuliah/jadual/script.js)
// ---------------------------------------------------------------------
function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------
// Warning parsing — thunderstorm (data.gov.my free text)
// ---------------------------------------------------------------------

// Splits "Kuantan, Pekan dan Rompin" / "Kuantan, Pekan and Rompin" /
// "Labuk & Sugut" into ["Kuantan", "Pekan", "Rompin"].
function splitDistrictList(capture) {
  return capture
    .split(/,|\bdan\b|\band\b|&/i)
    .map(s => s.trim())
    .filter(Boolean);
}

// Normalizes one raw district token from warning text against the
// active state's district list, via its alias table. Returns null (and
// warns) for anything unrecognized, rather than silently dropping it.
function resolveDistrictName(raw, cfg) {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cfg.aliases[norm]) return cfg.aliases[norm];
  const match = cfg.districts.find(d => d.toLowerCase() === norm);
  if (match) return match;
  console.warn('[weather] Unrecognized district name in warning text:', raw);
  return null;
}

// Marine/offshore bulletins ("... expected over the waters of Perlis &
// Kedah, Penang, ..., Pahang, ...") mention the state by name but
// describe sea conditions, not land districts — MET's phrasing
// consistently uses "waters of" / "perairan" right before that state
// list. Without this check, a marine-only bulletin would fall through
// to the state-wide fallback below and incorrectly paint every land
// district amber.
function isMarineBulletin(warning) {
  return /\bwaters?\s+of\b/i.test(warning.text_en || '') ||
    /\bperairan\b/i.test(warning.text_bm || '');
}

// ---------------------------------------------------------------------
// Phase 1 coastline warnings — SECTION A only ("FOR MALAYSIAN WATERS
// [WITHIN 24 NAUTICAL MILES]"). SECTION B ("FOR SHIPPING") names
// offshore blocks (Condore, Reef North, ...) with no district geometry
// — Phase 2, not handled here.
//
// Returns { scope:'coastal', districts, tier, category, items } or
// { scope:null, ... } when SECTION A never names this state's waters.
// `districts` is cfg.coastal (fallback: all cfg.districts) — the render
// layer paints these stroke-only, zero fill. Category → tier mapping
// reuses the land ladder so the legend stays one scale:
//   THIRD → bahaya, SECOND → buruk, FIRST / SEA RISE → waspada,
//   THUNDERSTORMS over waters → amaran. Highest wins per state.
// ---------------------------------------------------------------------
const MARINE_CATEGORY_TIER = { third: 'bahaya', second: 'buruk', first: 'waspada', searise: 'waspada', thunderstorm: 'amaran' };

function marineItemCategory(item) {
  if (/sea\s*level\s*rise/i.test(item)) return 'searise';
  if (/thunderstorms?\s+warning/i.test(item)) return 'thunderstorm';
  if (/third\s+category/i.test(item)) return 'third';
  if (/second\s+category/i.test(item)) return 'second';
  if (/first\s+category/i.test(item)) return 'first';
  return null;
}

function parseMarineForState(textEn, textBm, cfg) {
  if (!cfg || !cfg.apiName) return { scope: null, districts: [], tier: null, category: null, items: [] };
  const text = String(textEn || textBm || '');
  if (!text) return { scope: null, districts: [], tier: null, category: null, items: [] };
  // SECTION A only — cut before SECTION B (shipping/offshore blocks).
  const aPart = text.split(/SECTION\s+B\s*:|SEKSYEN\s+B\s*:/i)[0];
  if (!/for\s+malaysian\s+waters|within\s+24\s+nautical\s+miles/i.test(aPart)) {
    // No explicit SECTION A header (fixture or short bulletin) — still
    // allow a plain "waters of X" match rather than dropping it.
    if (!/\bwaters?\s+of\b/i.test(aPart) && !/\bperairan\b/i.test(String(textBm || ''))) {
      return { scope: null, districts: [], tier: null, category: null, items: [] };
    }
  }
  const items = splitBulletinItems(aPart);
  const bareRe = new RegExp('\\b' + escapeRegExp(cfg.apiName) + '\\b', 'i');
  const hits = [];
  items.forEach(item => {
    if (!bareRe.test(item)) return;
    if (!/\bwaters?\s+of\b/i.test(item) && !/\bperairan\b/i.test(item)) return;
    const cat = marineItemCategory(item);
    if (!cat) return;
    hits.push({ category: cat, tier: MARINE_CATEGORY_TIER[cat], text: item.trim().slice(0, 280) });
  });
  if (!hits.length) return { scope: null, districts: [], tier: null, category: null, items: [] };
  let best = hits[0];
  hits.forEach(h => { if (TIER_RANK[h.tier] > TIER_RANK[best.tier]) best = h; });
  const coastal = (cfg.coastal && cfg.coastal.length ? cfg.coastal : cfg.districts.slice())
    .filter(d => (cfg.districts || []).includes(d));
  return { scope: 'coastal', districts: coastal, tier: best.tier, category: best.category, items: hits };
}

// Parses one warning object into a district-level hit list, a state-wide
// land scope, a marine-only scope (no land districts highlighted, but
// still worth showing in the banner), or "not affected" (scope: null).
// All parsers return the same shape: { scope, districts, tiers, tier }
// where `tiers` maps district → severity tier and `tier` is the
// whole-state tier (scope 'state' only). Thunderstorm bulletins are
// always the untiered 'amaran'.
//
// The bare-mention gate below is required, not just defensive: this
// function's single-state caller (fetchActiveWarnings, via the API's
// contains=<state> filter) already guarantees every warning it sees
// mentions the state — but computeWarningStateNationwide() calls this
// same function once per state against ONE unfiltered nationwide fetch,
// where most states are NOT mentioned in any given bulletin. Without the
// gate, every unmentioned state fell through to the vague "state" branch
// below and got incorrectly washed by every bulletin, mentioned or not.
// Splits a comma-separated list on TOP-LEVEL commas only — commas inside
// "(...)" sub-groups (e.g. a division's district breakdown) don't count
// as separators. Used by extractRegionGroupDistricts() below.
function splitTopLevelGroups(text) {
  const tokens = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current);
  return tokens.map(t => t.trim()).filter(Boolean);
}

// Resolves a Sabah/Sarawak-style division-grouped segment, e.g. "Interior
// (Kuala Penyu, Beaufort and Membakut), West Coast (Papar, Penampang,
// Putatan and Kota Kinabalu)". Each top-level entry is either
// "Label (district, district)" — only the parenthesized districts count,
// the label is MET's division/region name and is NOT itself necessarily
// affected (confirmed by bulletins that repeat the label inside its own
// parens when they DO mean it, e.g. "Mukah (Daro, Matu, Mukah and
// Dalat)") — or a bare "District" with no sub-breakdown, which IS itself
// the affected district (e.g. "Sarikei", "Limbang").
function extractRegionGroupDistricts(segment, cfg) {
  const resolved = new Set();
  splitTopLevelGroups(segment).forEach(token => {
    // Date/prose fragments can leak in when the group capture runs past
    // "within the period of Monday, 9 November 2026" (groupRe only stops
    // at until/sehingga/end). District names never contain digits — skip
    // such tokens before they hit resolveDistrictName as noise.
    if (/\d/.test(token)) return;
    const m = token.match(/^(.*?)\s*\(([^)]+)\)/);
    if (m) {
      splitDistrictList(m[2]).forEach(raw => {
        const d = resolveDistrictName(raw, cfg);
        if (d) resolved.add(d);
      });
    } else {
      const d = resolveDistrictName(token, cfg);
      if (d) resolved.add(d);
    }
  });
  return Array.from(resolved);
}

function extractStateDistricts(warning, cfg) {
  // Check BOTH language fields, not just text_en with a text_bm fallback:
  // MET's EN/BM wordings differ ("states of Terengganu" vs "negeri
  // Terengganu"), so a guard matching one language can miss the other.
  // Confirmed live 2026-09-09: EN "over the states of Terengganu • ..."
  // matched neither fallback guard below, so Terengganu got no wash while
  // its BM text would have matched. District/group hits are unioned across
  // both texts; the vague-state fallback fires if EITHER text supports it.
  const texts = [warning.text_en, warning.text_bm].filter(t => typeof t === 'string' && t.length);
  const combined = texts.join('\n');

  const bareRe = new RegExp('\\b' + escapeRegExp(cfg.apiName) + '\\b', 'i');
  if (!bareRe.test(combined)) {
    return { scope: null, districts: [], tiers: {}, tier: null };
  }

  const re = new RegExp(escapeRegExp(cfg.apiName) + '\\s*\\(([^)]+)\\)', 'i');
  const resolvedUnion = new Set();
  texts.forEach(text => {
    const match = text.match(re);
    if (match) {
      splitDistrictList(match[1])
        .map(raw => resolveDistrictName(raw, cfg))
        .filter(Boolean)
        .forEach(d => resolvedUnion.add(d));
    }
  });
  if (resolvedUnion.size) {
    const resolved = Array.from(resolvedUnion);
    const tiers = {};
    resolved.forEach(d => { tiers[d] = 'amaran'; });
    return { scope: 'district', districts: resolved, tiers, tier: null };
  }

  // Sabah/Sarawak-style bulletins group districts under a named division,
  // e.g. "Sabah: Interior (Kuala Penyu, Beaufort and Membakut), West
  // Coast (Papar, Penampang, Putatan and Kota Kinabalu)" — the state name
  // is followed by a colon (not a direct paren) and a comma-separated
  // list of division groups, ending at the next "•" bulletin separator,
  // the "until"/"sehingga" clause, or end of string.
  const groupRe = new RegExp(
    escapeRegExp(cfg.apiName) + '\\s*:\\s*([\\s\\S]*?)(?=\\s*•|\\s+until\\b|\\s+sehingga\\b|$)',
    'i'
  );
  const groupMatch = combined.match(groupRe);
  if (groupMatch) {
    const resolved = extractRegionGroupDistricts(groupMatch[1], cfg);
    if (resolved.length) {
      const tiers = {};
      resolved.forEach(d => { tiers[d] = 'amaran'; });
      return { scope: 'district', districts: resolved, tiers, tier: null };
    }
  }

  if (isMarineBulletin(warning)) {
    return { scope: 'marine', districts: [], tiers: {}, tier: null };
  }

  // This last-resort fallback ("MET was vague about which district")
  // must only fire for a genuine hazard bulletin naming the state as its
  // subject ("... the state(s) of Pahang" / "... negeri Pahang") — not any
  // document that merely references the state in passing. Confirmed live
  // 2026-08-26: a "Tropical Storm Advisory" bulletin (unrelated hazard
  // type, "Threat to Malaysia: No significant impact") mentioned Sabah
  // only as a distance reference — "Approximately 1691 km from Northwest
  // Kudat, Sabah" — and without this guard the bare \bSabah\b match above
  // fell all the way through to here, incorrectly washing the entire
  // state on the map.
  // "states of" (plural) is the live EN form for multi-state bulletins
  // ("... over the states of Terengganu • ...", confirmed 2026-09-09) —
  // the singular-only form missed it and left Terengganu unwashed.
  // The optional "W.P. " covers federal territories written as
  // "W.P. Labuan" (confirmed same bulletin): the bare \bLabuan\b gate
  // above matches inside "W.P. Labuan", but neither guard below did.
  const stateAdvisoryRe = new RegExp('(?:states?\\s+of|negeri)\\s+(?:W\\.P\\.\\s+)?' + escapeRegExp(cfg.apiName) + '\\b', 'i');

  // Second, independent signal for the same fallback: a multi-state
  // bulletin only says "negeri"/"the state of" once, before the FIRST
  // state in a "•"-bulleted list — every state after that is bare by
  // construction, whether or not it also has its own (districts) list.
  // Confirmed live 2026-08-26: "...negeri Kedah (Langkawi) • Negeri
  // Sembilan (...) • Melaka • Johor (...)" — Melaka has no district list
  // AND no adjacent "negeri", so stateAdvisoryRe alone missed it and it
  // rendered with no wash at all. This checks the state name is flanked
  // by "•"/"negeri" on one side and "•"/end/the validity clause on the
  // other — i.e. it's clearly its own bulleted item, not a name that
  // just happens to appear elsewhere in unrelated prose (the Kudat/Sabah
  // case above: preceded by ", ", not "•" or "negeri" — doesn't match).
  const bulletedStateRe = new RegExp(
    '(?:\\bnegeri\\s+|•\\s*)(?:W\\.P\\.\\s+)?' + escapeRegExp(cfg.apiName) + '\\s*(?=\\s*•|$|\\s+(?:until|sehingga)\\b)',
    'i'
  );

  if (!stateAdvisoryRe.test(combined) && !bulletedStateRe.test(combined)) {
    return { scope: null, districts: [], tiers: {}, tier: null };
  }
  return { scope: 'state', districts: cfg.districts.slice(), tiers: {}, tier: 'amaran' };
}

function isWarningActive(w) {
  if (w.warning_issue && w.warning_issue.title_en === 'No Advisory') return false;
  // "Termination of ... / Penamatan ..." bulletins ANNOUNCE that a warning
  // has ended — rendering one as active would highlight the very districts
  // whose warning was just lifted. (Their valid_to usually expires within
  // minutes anyway, but don't rely on that race.) Rain bulletins are
  // exempt: their heading covers a MULTI-section document where
  // terminations are per-section (SEKSYEN C), handled in
  // parseRainForState() instead.
  if (w.source !== 'rain' &&
    (/termination/i.test(w.heading_en || '') || /penamatan/i.test(w.heading_bm || ''))) return false;
  if (w.valid_to) {
    const validTo = new Date(w.valid_to);
    if (!isNaN(validTo.getTime()) && validTo.getTime() < Date.now()) return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// MET continuous-rain warnings (via /api/weather-warning proxy)
//
// A rain bulletin is ONE multi-section prose string:
//   SECTION A: CONTINUOUS RAIN WARNING (SEVERE) ...
//   SECTION B: CONTINUOUS RAIN WARNING (ALERT) ...
//   SECTION C: TERMINATION OF CONTINUOUS RAIN WARNING ...
// Termination sections list areas whose warning just ENDED — they must
// be excluded before looking for the active state, or a lifted warning
// would re-highlight its districts (same principle as the
// isWarningActive termination guard for thunderstorm bulletins).
// ---------------------------------------------------------------------

// Severity of ONE rain section, read from its heading line only — e.g.
// "SECTION A: CONTINUOUS RAIN WARNING (SEVERE)" / "SEKSYEN A: AMARAN
// HUJAN BERTERUSAN (BURUK)". Body text is excluded so a sentence that
// merely mentions "danger" can't inflate the tier.
function rainSectionTier(section) {
  const headMatch = section.match(/^(?:SECTION|SEKSYEN)\s+[A-Z]\s*:[^\n]*/i);
  const head = headMatch ? headMatch[0] : section.split('\n')[0];
  if (/\b(DANGER|BAHAYA)\b/i.test(head)) return 'bahaya';
  if (/\b(SEVERE|BURUK)\b/i.test(head)) return 'buruk';
  return 'waspada'; // ALERT/WASPADA, or an unlabeled heading — lowest tier
}

function parseRainForState(textEn, cfg) {
  const sections = String(textEn || '')
    .split(/(?=SECTION\s+[A-Z]\s*:|SEKSYEN\s+[A-Z]\s*:)/i)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^(SECTION|SEKSYEN)\s+[A-Z]\s*:\s*(TERMINATION|PENAMATAN)/i.test(s));

  // Each section carries its own tier — do NOT join sections before
  // scanning, or "SECTION A (SEVERE): Maran / SECTION B (ALERT):
  // Temerloh" would collapse into one tierless district list.
  const tiers = {};        // district → highest tier across sections
  let stateTier = null;    // tier of any section naming the state without districts

  const parenRe = new RegExp(escapeRegExp(cfg.apiName) + '\\s*\\(([^)]+)\\)', 'i');
  const bareRe = new RegExp('\\b' + escapeRegExp(cfg.apiName) + '\\b', 'i');

  const groupRe = new RegExp(
    escapeRegExp(cfg.apiName) + '\\s*:\\s*([\\s\\S]*?)(?=\\s*\u2022|\\s+until\\b|\\s+sehingga\\b|$)',
    'i'
  );

  sections.forEach(section => {
    const tier = rainSectionTier(section);
    const m = section.match(parenRe);
    if (m) {
      splitDistrictList(m[1]).map(raw => resolveDistrictName(raw, cfg)).filter(Boolean).forEach(d => {
        if (!tiers[d] || TIER_RANK[tier] > TIER_RANK[tiers[d]]) tiers[d] = tier;
      });
    } else {
      // Sabah/Sarawak division-grouped shape, e.g. "Sabah: Kudat,
      // Sandakan (Paitan, ...)" — same structure extractStateDistricts()
      // handles for thunderstorm bulletins, but tier-aware here.
      const gm = section.match(groupRe);
      if (gm) {
        const resolved = extractRegionGroupDistricts(gm[1], cfg);
        if (resolved.length) {
          resolved.forEach(d => {
            if (!tiers[d] || TIER_RANK[tier] > TIER_RANK[tiers[d]]) tiers[d] = tier;
          });
        } else if (bareRe.test(section)) {
          if (!stateTier || TIER_RANK[tier] > TIER_RANK[stateTier]) stateTier = tier;
        }
      } else if (bareRe.test(section)) {
        if (!stateTier || TIER_RANK[tier] > TIER_RANK[stateTier]) stateTier = tier;
      }
    }
  });

  const districts = Object.keys(tiers);
  if (stateTier) {
    // Some section covered the state with no district detail — whole
    // state gets that tier's wash; explicit district tiers still paint
    // on top.
    return { scope: 'state', districts: districts.length ? districts : cfg.districts.slice(), tiers, tier: stateTier };
  }
  if (districts.length) {
    return { scope: 'district', districts, tiers, tier: null };
  }
  return { scope: null, districts: [], tiers: {}, tier: null }; // active state not affected — don't show
}

// Normalizes metapi2's RAIN payload rows into the shape the rest of this
// file consumes (heading_bm, text_bm, valid_to...) plus `source: 'rain'`
// — no state-scoping yet, that's layered on by the two callers below
// depending on whether they need one state's slice or all of them.
function normalizeRainRows(metJson) {
  const rows = (metJson && Array.isArray(metJson.results)) ? metJson.results : [];
  return rows.map(row => {
    const v = row.value || {};
    const attrs = row.attributes || {};
    const textEn = v.text?.en?.warning || '';
    const textBm = v.text?.ms?.warning || '';
    return {
      source: 'rain',
      warning_issue: {
        issued: attrs.timestamp || row.date,
        title_en: attrs.title?.en || v.heading?.en || 'Continuous Rain Warning',
        title_bm: attrs.title?.ms || v.heading?.ms || 'Amaran Hujan Berterusan',
      },
      heading_en: attrs.title?.en || v.heading?.en || '',
      heading_bm: attrs.title?.ms || v.heading?.ms || '',
      text_en: textEn,
      text_bm: textBm,
      instruction_bm: null,
      valid_from: attrs.valid_from || null,
      valid_to: attrs.valid_to || null,
    };
  });
}

// Single-state shape: adds the precomputed `stateScope` the rest of the
// single-state code path consumes, and drops rows whose active sections
// never mention the active state at all (noise for a single-state page).
function normalizeRainWarnings(metJson, cfg) {
  return normalizeRainRows(metJson)
    .map(w => ({ ...w, stateScope: parseRainForState(w.text_en || w.text_bm, cfg) }))
    .filter(w => w.stateScope.scope !== null);
}

async function fetchRainWarnings(cfg) {
  const resp = await fetchWithTimeout(RAIN_PROXY_URL, 8000);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  return normalizeRainWarnings(data, cfg).filter(isWarningActive);
}

// Nationwide shape: same one proxy fetch, but no per-state stateScope/
// filtering — computeWarningStateNationwide() does that itself, once per
// state, entirely client-side (see that function's own comment for why
// no extra requests are needed).
async function fetchRainWarningsRaw() {
  const resp = await fetchWithTimeout(RAIN_PROXY_URL, 8000);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  return normalizeRainRows(data).filter(isWarningActive);
}

// ---------------------------------------------------------------------
// Duplicate-bulletin resolution — data.gov.my's warning endpoint returns
// one row PER NUMBERED ITEM of a combined bulletin (e.g. "1) ... negeri
// Terengganu ... sehingga 2:00 Pagi ... 2) ... Sabah ... sehingga 4:00
// Pagi ... 3) ... Sarawak ... sehingga 3:00 Pagi"), but every row repeats
// the FULL combined text verbatim and only its own valid_to actually
// belongs to its own numbered item — confirmed against MET's own printed
// bulletin poster, which prints one line per item, each with that item's
// own "sehingga" expiry. Left un-deduped, a query matching more than one
// of these rows shows a misleading "+N lagi" badge and may display the
// WRONG item's expiry for the state actually being rendered (whichever
// row the API happened to return first). Rain bulletins are excluded —
// their SEKSYEN structure/termination handling in parseRainForState()
// already covers multi-section bulletins a different way.
// ---------------------------------------------------------------------
function bulletinSignature(w) {
  return `${w.warning_issue?.issued || ''}|${w.heading_bm || w.heading_en || ''}|${w.text_bm || w.text_en || ''}`;
}

// Picks the one row in a duplicate group whose valid_to genuinely belongs
// to `segmentText` (the slice of the bulletin starting at the target
// state's own mention) — matched by comparing valid_to's clock time (hour
// mod 12, minute) against the "sehingga/until H:MM" clause immediately
// following that mention. Falls back to the group's first row if no
// digit match is found (unusual bulletin wording), so nothing is ever
// dropped silently.
function pickRowForSegment(group, segmentText) {
  const m = segmentText.match(/(?:sehingga|until)\s+(\d{1,2}):(\d{2})/i);
  if (!m) return group[0];
  const h = parseInt(m[1], 10) % 12;
  const min = parseInt(m[2], 10);
  const hit = group.find(w => {
    if (!w.valid_to) return false;
    const d = new Date(w.valid_to);
    return !isNaN(d.getTime()) && d.getHours() % 12 === h && d.getMinutes() === min;
  });
  return hit || group[0];
}

// Groups `warnings` by bulletinSignature() and, for a duplicate group
// belonging to a single named state (apiName truthy — nationwide's own
// unfiltered fetch is handled per-state inside computeWarningStateNationwide
// instead), collapses it down to the one row that actually belongs to
// `cfg`'s state via pickRowForSegment(). Non-duplicate and rain-source
// rows pass through unchanged.
function resolveDuplicateBulletins(warnings, cfg) {
  if (!cfg.apiName) return warnings; // nationwide's raw fetch — leave duplicates for computeWarningStateNationwide to resolve per-state

  const groups = new Map();
  warnings.forEach(w => {
    const key = (w.source === 'rain' ? 'rain:' : '') + bulletinSignature(w);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  });

  const result = [];
  groups.forEach((group, key) => {
    if (group.length === 1 || key.startsWith('rain:')) {
      result.push(...group);
      return;
    }
    const text = group[0].text_bm || group[0].text_en || '';
    const idx = text.search(new RegExp('\\b' + escapeRegExp(cfg.apiName) + '\\b', 'i'));
    const segmentText = idx >= 0 ? text.slice(idx) : text;
    result.push(pickRowForSegment(group, segmentText));
  });
  return result;
}

// Splits a combined bulletin's free text into its enumerated items ("1)
// ... sehingga <time>; <date>. 2) ... sehingga <time>; <date>. ...") — MET
// sometimes issues ONE bulletin covering several states/areas this way,
// each numbered item carrying its own expiry (see pickRowForSegment()
// above). Bulletins with no numbering (a single area) come back as a
// single-element array holding the whole text. Used by index.html's
// renderNationwidePanel() so the summary bar shows one line per item,
// matching MET's own printed poster, instead of naively slicing from the
// first "sehingga" to the end of the string — which silently dropped
// every item after the first.
// Splits on Arabic ("1) 2)") AND Roman ("I) II)") item markers — MET
// uses Roman numerals for multi-part rain bulletins (live 2026-11-06:
// "I) ... Kelantan ... II) ... Sabah ..."), Arabic for multi-state
// thunderstorm ones. District parens never match: they hold names,
// not a bare numeral/roman + ")" + space at an item start. The
// (?<![IVXLCDM\d]) guard stops "II)" splitting twice (second "I)" is
// part of the longer numeral, not a new item).
function splitBulletinItems(text) {
  const str = String(text || '').trim();
  if (!str) return [];
  const parts = str.split(/(?<![IVXLCDM\d])(?=(?:\d+|[IVXLCDM]+)\)\s+)/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [str];
  // Multi-item bulletin: the text before the first marker is just the
  // repeated heading (e.g. "AMARAN HUJAN BERTERUSAN (WASPADA) I) ..."),
  // not an item — drop any leading fragment without its own marker.
  const items = parts.filter(s => /^(?:\d+|[IVXLCDM]+)\)\s+/.test(s));
  return items.length ? items : [str];
}

// Defensive "Continuous Rain" catch on the data.gov.my (thunderstorm)
// source. Live 2026-11-06: this endpoint now returns CONTINUOUS RAIN
// WARNING bulletins too — previously it carried thunderstorm types only.
// MET proxy stays the primary rain source; this only re-labels the
// free-endpoint copy so it lands in the Hujan Berterusan card (yellow)
// instead of being misread as a blue Ribut Petir warning.
function isContinuousRainHeading(w) {
  return /continuous rain/i.test(w.heading_en || w.text_en || '') ||
    /hujan berterusan/i.test(w.heading_bm || w.text_bm || '');
}

// Re-labels free-endpoint rain bulletins to source rain. Runs AFTER
// resolveDuplicateBulletins so the duplicate-row collapse still treats
// them as thunder rows with per-state pickRowForSegment. No precomputed
// stateScope here — stateScopeOf() falls back to parseRainForState()
// when stateScope is absent, covering single and nationwide paths.
function reclassifyRainWarnings(warnings) {
  return warnings.map(w => !isContinuousRainHeading(w) ? w : { ...w, source: 'rain' });
}

// Cross-source duplicate: the same rain bulletin can now arrive twice —
// once via the free endpoint (reclassified above) and once via the MET
// proxy — with only whitespace differences. Keeps the first copy so
// cards do not show a misleading "+1 lagi" for one bulletin.
function dedupeAcrossSources(warnings) {
  const seen = new Set();
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return warnings.filter(w => {
    const key = (w.source === 'rain' ? 'rain:' : '') + norm(w.heading_bm || w.heading_en) + '|' + norm(w.text_bm || w.text_en);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchActiveWarnings(cfg) {
  const resp = await fetchWithTimeout(buildWarningApiUrl(cfg));
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const rows = Array.isArray(data) ? data : [];
  return reclassifyRainWarnings(resolveDuplicateBulletins(rows.filter(isWarningActive), cfg));
}

// Rain warnings carry a precomputed `stateScope` (SEKSYEN-aware);
// thunderstorm/other data.gov.my warnings are parsed on the fly.
function stateScopeOf(w, cfg) {
  if (w.source === 'rain') return w.stateScope || parseRainForState(w.text_en || w.text_bm, cfg);
  return extractStateDistricts(w, cfg);
}

// Parent→children expansion for MET-combined areas: MET names the parent
// district but means the whole area (live 2026-11-06: "Gua Musang" covers
// "Kecil Lojing", a separate polygon in jakim.geojson — painting only the
// parent leaves a white hole). cfg.combined = { Parent: [child, ...] }
// (see kelantan in states.json). A child hit directly keeps its own tier;
// only an unhit-or-lower child inherits the parent tier.
function expandCombinedDistricts(districts, cfg) {
  const combined = (cfg && cfg.combined) || {};
  Object.entries(combined).forEach(([parent, children]) => {
    const pt = districts.get(parent);
    if (!pt) return;
    (children || []).forEach(child => {
      const ct = districts.get(child);
      if (!ct || TIER_RANK[pt] > TIER_RANK[ct]) districts.set(child, pt);
    });
  });
  return districts;
}

// Per-source hit expansion for the rain+thunder overlap outline: when a
// parent district is hit by one source (live: "Gua Musang" covers
// "Kecil Lojing"), its combined children count as hit by that source too,
// so a rain-parent + thunder-child (or vice versa) still shows overlap.
function expandCombinedHitSet(hitSet, cfg) {
  const combined = (cfg && cfg.combined) || {};
  Object.entries(combined).forEach(([parent, children]) => {
    if (!hitSet.has(parent)) return;
    (children || []).forEach(c => hitSet.add(c));
  });
  return hitSet;
}

function computeWarningState(warnings, cfg) {
  const districts = new Map(); // district → highest tier across all warnings
  const thunderHit = new Set(); // districts named by any thunder (amaran) warning
  const rainHit = new Set();    // districts named by any rain warning
  let scope = null;            // null | 'district' | 'state'
  let stateTier = null;

  warnings.forEach(w => {
    const isRain = w.source === 'rain';
    const parsed = stateScopeOf(w, cfg);
    if (parsed.scope === 'marine' || parsed.scope === null) return; // no land district affected
    if (parsed.scope === 'state') {
      scope = 'state'; // state wash for the vague warning — district tiers still paint on top
      const t = parsed.tier || 'amaran';
      if (!stateTier || TIER_RANK[t] > TIER_RANK[stateTier]) stateTier = t;
    } else if (scope !== 'state') {
      scope = 'district';
    }
    Object.entries(parsed.tiers || {}).forEach(([d, t]) => {
      (isRain ? rainHit : thunderHit).add(d);
      const cur = districts.get(d);
      if (!cur || TIER_RANK[t] > TIER_RANK[cur]) districts.set(d, t);
    });
  });

  expandCombinedDistricts(districts, cfg);
  expandCombinedHitSet(thunderHit, cfg);
  expandCombinedHitSet(rainHit, cfg);
  // Overlap = painted districts hit by BOTH sources. Winner stays rain
  // (TIER_RANK), so the map keeps the rain fill and draws the thunder
  // outline on top — no severity lie.
  const overlap = new Set([...thunderHit].filter(d => rainHit.has(d) && districts.has(d)));

  return { scope, districts, stateTier, overlap };
}

// Nationwide equivalent of computeWarningState() — instead of one cfg, runs
// each warning through EVERY real state's own extractStateDistricts()/
// parseRainForState() unchanged. This works because a single MET bulletin's
// raw text already lists multiple states in one string (that's exactly how
// the single-state path pulls out just its own slice today) — so no new
// parsing logic is needed, just looping the existing per-state parsers in
// memory over one already-fetched, unfiltered batch (see
// buildWarningApiUrl()'s no-contains branch and fetchRainWarningsRaw()).
//
// Returns per-district tiers (same shape as computeWarningState) PLUS a
// stateCode → tier wash map, since a vague "whole state, no district
// detail" warning must only wash THAT state's districts — unlike the
// single-state page (only one state ever on screen, so a bare
// warningScope === 'state' flag was enough), nationwide mode renders many
// states at once and needs to know which one each wash belongs to.
//
// Also returns `perState` (stateCode → summary), accumulated in this same
// loop — a nationwide-only plain-text warning panel needs one line per
// affected state (tier, district count, valid_to, which source(s)), and
// this loop already computes exactly that per (warning, state) pair. Doing
// it here avoids a second pass re-deriving the same parse.
function computeWarningStateNationwide(warnings, allStates) {
  const districts = new Map(); // district name → highest tier
  const thunderHit = new Set(); // districts named by any thunder warning
  const rainHit = new Set();    // districts named by any rain warning
  const stateWash = new Map(); // stateCode → highest tier
  const perState = new Map();  // stateCode → { tier, scope, districtCount, validTo, sources }
  const districtSets = new Map(); // stateCode → Set(district) — private accumulator for perState's districtCount

  const stateCfgs = Object.values(allStates).filter(s => s.apiName && s.stateCode);

  // Grouped once — duplicate bulletin rows (see resolveDuplicateBulletins
  // above) need a different representative row picked per state, but the
  // grouping itself is state-independent.
  const groups = new Map();
  warnings.forEach(w => {
    const key = (w.source === 'rain' ? 'rain:' : '') + bulletinSignature(w);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  });

  stateCfgs.forEach(stateCfg => {
    groups.forEach((group, key) => {
      let w = group[0];
      if (group.length > 1 && !key.startsWith('rain:')) {
        const text = group[0].text_bm || group[0].text_en || '';
        const idx = text.search(new RegExp('\\b' + escapeRegExp(stateCfg.apiName) + '\\b', 'i'));
        const segmentText = idx >= 0 ? text.slice(idx) : text;
        w = pickRowForSegment(group, segmentText);
      }

      const parsed = w.source === 'rain'
        ? parseRainForState(w.text_en || w.text_bm, stateCfg)
        : extractStateDistricts(w, stateCfg);
      if (parsed.scope === 'marine' || parsed.scope === null) return;
      if (parsed.scope === 'state') {
        const t = parsed.tier || 'amaran';
        const cur = stateWash.get(stateCfg.stateCode);
        if (!cur || TIER_RANK[t] > TIER_RANK[cur]) stateWash.set(stateCfg.stateCode, t);
      }
      Object.entries(parsed.tiers || {}).forEach(([d, t]) => {
        (w.source === 'rain' ? rainHit : thunderHit).add(d);
        const cur = districts.get(d);
        if (!cur || TIER_RANK[t] > TIER_RANK[cur]) districts.set(d, t);
      });

      // Highest tier this (warning, state) pair carries — mirrors the
      // accentTier logic renderWarnCard() already uses per-card.
      let tier = parsed.tier || 'amaran';
      Object.values(parsed.tiers || {}).forEach(t => {
        if (TIER_RANK[t] > TIER_RANK[tier]) tier = t;
      });

      const code = stateCfg.stateCode;
      if (!districtSets.has(code)) districtSets.set(code, new Set());
      if (parsed.scope === 'district') parsed.districts.forEach(d => districtSets.get(code).add(d));

      const cur = perState.get(code);
      const isHigher = !cur || TIER_RANK[tier] > TIER_RANK[cur.tier];
      const entry = cur || { tier, scope: parsed.scope, validTo: w.valid_to, sources: new Set() };
      if (isHigher) { entry.tier = tier; entry.scope = parsed.scope; entry.validTo = w.valid_to; }
      entry.sources.add(w.source === 'rain' ? 'rain' : 'amaran');
      perState.set(code, entry);
    });
  });

  Object.values(allStates).filter(s => s.apiName && s.stateCode).forEach(stateCfg => {
    const before = districts.size;
    expandCombinedDistricts(districts, stateCfg);
    // children adopted via combined() count as covered districts
    if (districts.size !== before && perState.has(stateCfg.stateCode)) {
      const entry = perState.get(stateCfg.stateCode);
      stateCfg.combined && Object.entries(stateCfg.combined).forEach(([parent, children]) => {
        if (districts.has(parent)) (children || []).forEach(c => {
          if (districts.has(c)) districtSets.get(stateCfg.stateCode).add(c);
        });
      });
      entry.districtCount = districtSets.get(stateCfg.stateCode).size;
    }
  });

  perState.forEach((entry, code) => { entry.districtCount = districtSets.get(code).size; });

  Object.values(allStates).filter(s => s.apiName && s.stateCode).forEach(stateCfg => {
    expandCombinedHitSet(thunderHit, stateCfg);
    expandCombinedHitSet(rainHit, stateCfg);
  });
  const overlap = new Set([...thunderHit].filter(d => rainHit.has(d) && districts.has(d)));

  return { districts, stateWash, perState, overlap };
}

// ---------------------------------------------------------------------
// Small shared formatters
// ---------------------------------------------------------------------
function formatValidTo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace('PG', 'AM').replace('PTG', 'PM');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// ?testWarning= fixtures — same convention as waktu-solat/index.html's
// ?testDate=/?testTime=. Supported values:
//   none                    — no active warnings
//   state                   — whole-state land advisory (no district detail)
//   marine                  — offshore-only bulletin (must NOT highlight any district)
//   district:Temerloh       — one district
//   district:Kuantan,Pekan  — multiple districts
//   rain                    — continuous-rain bulletin, whole-state (Waspada)
//   rain:Temerloh,Maran     — continuous-rain, specific districts (Waspada)
//   rain:buruk              — whole-state at a tier (waspada|buruk|bahaya)
//   rain:bahaya:Maran       — specific districts at a tier
//   rain:buruk:Maran;waspada:Temerloh,Bera
//                           — multi-SECTION bulletin, one section per
//                             ;-group (tests per-section tier colouring
//                             and highest-tier-wins)
//
// Any of the above can be combined with '|' to populate the Ribut Petir
// and Hujan Berterusan cards at once, e.g.:
//   district:Kuantan,Pekan|rain:buruk:Maran
// ('+' was tried first but query strings decode '+' as a space before this
// code ever sees it, so it can never be told apart from a literal space.)
//
// Builds a fixture `activeWarnings` array from the given param value, or
// returns undefined when the param is absent/unrecognized so callers
// fall back to the live API. Fixtures run through the exact same
// extractStateDistricts()/computeWarningState() code path as real
// API data — this only replaces the network fetch, never the logic
// being tested. District names in fixtures (e.g. the district: examples
// above) are Pahang names for illustration only — pass real districts
// of whichever state is active via cfg.districts.
// ---------------------------------------------------------------------
function getTestWarningFixture(param, cfg) {
  if (!param) return undefined;

  // '|' combines independent specs (e.g. one thunderstorm + one rain) into
  // a single fixture set — split and recurse rather than duplicating the
  // parsing logic below.
  if (param.includes('|')) {
    const combined = [];
    for (const part of param.split('|').map(s => s.trim()).filter(Boolean)) {
      const fixture = getTestWarningFixture(part, cfg);
      if (fixture) combined.push(...fixture);
    }
    return combined;
  }

  const now = new Date();
  const base = {
    warning_issue: { issued: now.toISOString(), title_en: 'Thunderstorms Warning', title_bm: 'Amaran Ribut Petir' },
    valid_from: now.toISOString(),
    valid_to: new Date(now.getTime() + 3600000).toISOString(), // +1 hour
    heading_bm: 'Amaran Ribut Petir (UJIAN)',
    heading_en: 'Thunderstorms Warning (TEST)',
    instruction_bm: 'Ini adalah data ujian dari ?testWarning=, bukan amaran sebenar.',
  };

  if (param === 'none') return [];

  if (param === 'state') {
    return [{ ...base, text_en: `Thunderstorms are expected over the state of ${cfg.apiName} generally.`, text_bm: `Ribut petir dijangka di negeri ${cfg.apiName} secara umum.` }];
  }

  if (param === 'marine') {
    return [{ ...base, text_en: `Thunderstorms expected over the waters of ${cfg.apiName}.`, text_bm: `Ribut petir dijangka di kawasan perairan ${cfg.apiName}.` }];
  }

  if (param.startsWith('district:')) {
    const list = param.slice('district:'.length).split(',').map(s => s.trim()).filter(Boolean).join(', ');
    return [{ ...base, text_en: `Thunderstorms Warning for ${cfg.apiName} (${list})`, text_bm: `Amaran Ribut Petir untuk ${cfg.apiName} (${list})` }];
  }

  // rain fixtures — built as a real metapi2-shaped payload and run
  // through the SAME normalizeRainWarnings()/parseRainForState() path as
  // proxy data, always including a trailing TERMINATION section that
  // the parser must ignore. Syntax (see the block comment above):
  //   rain | rain:<districts> | rain:<tier> | rain:<tier>:<districts>
  //   multiple ;-separated groups become SECTION A, B, ... each with
  //   its own tier heading.
  if (param === 'rain' || param.startsWith('rain:')) {
    const TIER_WORDS = {
      waspada: { en: 'ALERT', bm: 'WASPADA', headEn: 'Alert', headBm: 'Waspada' },
      buruk: { en: 'SEVERE', bm: 'BURUK', headEn: 'Severe', headBm: 'Buruk' },
      bahaya: { en: 'DANGER', bm: 'BAHAYA', headEn: 'Danger', headBm: 'Bahaya' },
    };
    const spec = param === 'rain' ? '' : param.slice('rain:'.length);
    const groups = spec.split(';').map(g => g.trim());

    const sectionsEn = [];
    const sectionsBm = [];
    let maxTier = 'waspada';
    groups.forEach((group, idx) => {
      const parts = group.split(':').map(s => s.trim());
      let tier = 'waspada';
      let list = parts[0] || null;
      if (parts[0] && TIER_WORDS[parts[0].toLowerCase()]) {
        tier = parts[0].toLowerCase();
        list = parts[1] || null;
      }
      if (list) list = list.split(',').map(s => s.trim()).filter(Boolean).join(', ');
      if (TIER_RANK[tier] > TIER_RANK[maxTier]) maxTier = tier;

      const letter = String.fromCharCode(65 + idx); // A, B, C ...
      const w = TIER_WORDS[tier];
      const areaEn = list ? `${cfg.apiName} (${list})` : `the state of ${cfg.apiName}`;
      const areaBm = list ? `${cfg.apiName} (${list})` : `negeri ${cfg.apiName}`;
      // ". (TEST DATA)" — the period matters: "<State> (TEST DATA)" would
      // match the district-list regex and swallow the state-wide case.
      sectionsEn.push(`SECTION ${letter}: CONTINUOUS RAIN WARNING (${w.en})\nContinuous rain is expected to occur over ${areaEn}. (TEST DATA)`);
      sectionsBm.push(`SEKSYEN ${letter}: AMARAN HUJAN BERTERUSAN (${w.bm})\nHujan berterusan dijangka berlaku di ${areaBm}. (DATA UJIAN)`);
    });

    // A trailing termination section the parser must ignore — references
    // a real district of the active state so the exclusion is actually
    // exercised (not just an empty/no-op section).
    const termDistrict = cfg.districts[cfg.districts.length - 1];
    const termLetter = String.fromCharCode(65 + groups.length);
    sectionsEn.push(`SECTION ${termLetter}: TERMINATION OF CONTINUOUS RAIN WARNING\nContinuous Rain Warning (Alert) for ${cfg.apiName} (${termDistrict}) is now terminated.`);
    sectionsBm.push(`SEKSYEN ${termLetter}: PENAMATAN AMARAN HUJAN BERTERUSAN\nAmaran Hujan Berterusan (Waspada) untuk ${cfg.apiName} (${termDistrict}) kini ditamatkan.`);

    const headEn = `Continuous Rain Warning (${TIER_WORDS[maxTier].headEn}) (TEST)`;
    const headBm = `Amaran Hujan Berterusan (${TIER_WORDS[maxTier].headBm}) (UJIAN)`;
    const metShaped = {
      results: [{
        date: base.warning_issue.issued,
        datatype: 'RAIN',
        value: {
          heading: { en: headEn, ms: headBm },
          text: {
            en: { warning: sectionsEn.join('\n') },
            ms: { warning: sectionsBm.join('\n') },
          },
        },
        attributes: {
          title: { en: headEn, ms: headBm },
          timestamp: base.warning_issue.issued,
          valid_from: base.valid_from,
          valid_to: base.valid_to,
        },
      }],
    };
    return normalizeRainWarnings(metShaped, cfg);
  }

  console.warn('[weather] Unknown ?testWarning= value, falling back to live API:', param);
  return undefined;
}

// Multi-state test specs: `Kelantan:first;Terengganu:third;Pahang:second`
// (groups split on ';', each `State:category` in either order, or a bare
// category applying to the active state / every coastal state). Returns
// [{ state: rawName|null, category }]; unknown single tokens fall back to
// 'first' so `Kelantan` alone means Kelantan waters, first category.
function parseCoastalTestGroups(param) {
  const CATS = ['first', 'second', 'third', 'searise', 'thunder'];
  const v = String(param == null ? '' : param).trim();
  if (!v) return [{ state: null, category: 'first' }];
  return v.split(';').map(s => s.trim()).filter(Boolean).map(g => {
    const parts = g.split(':').map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      const c = parts[0].toLowerCase();
      if (CATS.includes(c)) return { state: null, category: c };
      return { state: parts[0], category: 'first' };
    }
    const a = parts[0].toLowerCase(), b = parts[1].toLowerCase();
    if (CATS.includes(b)) return { state: parts[0], category: b };
    if (CATS.includes(a)) return { state: parts[1], category: a };
    return { state: parts[0], category: 'first' };
  });
}

// Single-state slice of a (possibly multi) test spec: the group naming
// this state wins, else a bare category, else nothing (other states'
// groups don't leak onto the active state).
function getCoastalFixtureForState(param, cfg) {
  const groups = parseCoastalTestGroups(param);
  const lname = s => String(s || '').toLowerCase();
  const named = groups.find(g => g.state && (lname(g.state) === lname(cfg.apiName) || lname(g.state) === lname(cfg.displayName)));
  const g = named || groups.find(x => !x.state);
  if (!g) return [];
  return getTestCoastalFixture(g.category, cfg) || [];
}
// ---------------------------------------------------------------------
// ?testcoastalwarning= fixture — Phase 1 coastline test path, separate
// from ?testWarning= so land fixtures stay untouched. Values:
//   (empty) / 1 / first   — FIRST CATEGORY over active state's waters
//   second / third        — SECOND / THIRD CATEGORY
//   searise               — SEA LEVEL RISE over active state's waters
//   thunder               — THUNDERSTORMS over active state's waters
// Builds a real data.gov.my-shaped warning through the SAME
// parseMarineForState() path as live data — never bypasses parsing.
// ---------------------------------------------------------------------
function getTestCoastalFixture(param, cfg) {
  if (param === undefined || param === null) return undefined;
  const v = String(param).trim().toLowerCase();
  // Bare ?testcoastalwarning (empty value) means FIRST CATEGORY.
  const kind = (!v || v === '1' || v === 'true') ? 'first' : v;
  const CAT = {
    first: { head: 'FIRST CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS', body: 'Strong easterly winds of 40 - 50 kmph with wave height up to 3.5 metres are expected' },
    second: { head: 'SECOND CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS', body: 'Strong northeasterly winds of 50 - 60 kmph with wave height up to 4.5 metres are expected' },
    third: { head: 'THIRD CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS', body: 'Strong northeasterly winds over 60 kmph with waves exceeding 4.5 metres are expected' },
    searise: { head: 'WARNING ON SEA LEVEL RISE', body: 'Sea level rise is expected' },
    thunder: { head: 'THUNDERSTORMS WARNING', body: 'Thunderstorms, heavy rain and strong winds are expected' },
  };
  if (!CAT[kind]) {
    console.warn('[weather] Unknown ?testcoastalwarning= value, falling back to live API:', param);
    return undefined;
  }
  const now = new Date();
  const c = CAT[kind];
  const textEn = `SECTION A: FOR MALAYSIAN WATERS [WITHIN 24 NAUTICAL MILES]\n1) ${c.head}\n${c.body} over the waters of ${cfg.apiName} until 9:00 PM; (TEST DATA).\nSECTION B: FOR SHIPPING\n1) THUNDERSTORMS WARNING\nThunderstorms are expected over the waters of Condore until 9:00 PM; (TEST DATA, must be ignored by Phase 1).`;
  const textBm = `SEKSYEN A: UNTUK PERAIRAN MALAYSIA [DALAM 24 BATU NAUTIKA]\n1) ${c.head}\n${c.body} di kawasan perairan ${cfg.apiName} sehingga 9:00 malam; (DATA UJIAN).\nSEKSYEN B: UNTUK PERKAPALAN\n1) THUNDERSTORMS WARNING\nThunderstorms are expected over the waters of Condore until 9:00 PM; (DATA UJIAN, mesti diabaikan oleh Fasa 1).`;
  return [{
    warning_issue: { issued: now.toISOString(), title_en: c.head, title_bm: c.head },
    valid_from: now.toISOString(),
    valid_to: new Date(now.getTime() + 3600000).toISOString(),
    heading_en: c.head + ' (TEST)',
    heading_bm: c.head + ' (UJIAN)',
    text_en: textEn,
    text_bm: textBm,
    instruction_bm: 'Ini adalah data ujian dari ?testcoastalwarning=, bukan amaran sebenar.',
  }];
}
