// src/data/earningsService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, getCurrentWeekRangeEst, isOlderThanMinutes } from './timezone.js';
import { getCompanyProfile } from './companyService.js';
import { IMPORTANT_TICKERS } from './importantTickers.js';

// Market cap threshold: only show companies above this (Finnhub profile2 marketCap is typically in billions)
const MIN_MARKET_CAP = 5;

// Cap the total number of earnings shown in a week (mobile-friendly)
const MAX_EARNINGS_COUNT = 30;

const EARNINGS_REFRESH_MINUTES = 60 * 24; // at most once/day per week

let earningsState = {
  weekKey: null,     // e.g. '2025-47'
  dataByDay: null,   // { Monday: { BMO: [], AMC: [] }, ... }
  lastFetch: null,
  status: 'idle',
  error: null,
};

// ---------- cache ----------
function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.earningsCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    earningsState.weekKey = parsed.weekKey || null;
    earningsState.dataByDay = parsed.dataByDay || null;
    earningsState.lastFetch = parsed.lastFetch || null;
  } catch (_) {}
}

function saveCache() {
  const snapshot = {
    weekKey: earningsState.weekKey,
    dataByDay: earningsState.dataByDay,
    lastFetch: earningsState.lastFetch,
  };
  localStorage.setItem(STORAGE_KEYS.earningsCache, JSON.stringify(snapshot));
}

loadCache();

// ---------- helpers ----------
function makeWeekKey(mondayIso) {
  const d = new Date(mondayIso);
  const year = d.getUTCFullYear();
  const oneJan = new Date(Date.UTC(year, 0, 1));
  const diff = d - oneJan;
  const week = Math.ceil((diff / 86400000 + oneJan.getUTCDay() + 1) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function emptyWeekStruct() {
  const base = {};
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((day) => {
    base[day] = { BMO: [], AMC: [] };
  });
  return base;
}

function weekdayNameFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayIdx = d.getUTCDay(); // 0=Sun..6=Sat
  switch (dayIdx) {
    case 1: return 'Monday';
    case 2: return 'Tuesday';
    case 3: return 'Wednesday';
    case 4: return 'Thursday';
    case 5: return 'Friday';
    default: return null;
  }
}

function sessionFromHour(hour) {
  if (!hour) return 'AMC';
  const norm = String(hour).toLowerCase();
  if (norm === 'bmo') return 'BMO';
  if (norm === 'amc') return 'AMC';
  return 'AMC';
}

// NY date string YYYY-MM-DD (no UTC surprises)
function fmtNYDateYYYYMMDD(dateObj) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(dateObj);
}

// De-dupe earnings rows (Finnhub can repeat)
function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const sym = String(e?.symbol || '').toUpperCase();
    const key = `${sym}|${e?.date || ''}|${String(e?.hour || '')}`;
    if (!sym || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, symbol: sym });
  }
  return out;
}

// IMPORTANT_TICKERS rank map (lower index = more important/bigger)
const IMPORTANT_SET = new Set(IMPORTANT_TICKERS.map((t) => String(t).toUpperCase()));
const IMPORTANT_RANK = new Map(
  IMPORTANT_TICKERS.map((t, idx) => [String(t).toUpperCase(), idx])
);

function rankOf(symbol) {
  const key = String(symbol || '').toUpperCase();
  const r = IMPORTANT_RANK.get(key);
  return typeof r === 'number' ? r : 1e9;
}

// Fetch profiles ONLY for a small set (top 30 symbols), with mild throttling
async function fetchProfilesForSymbolsLimited(symbols) {
  const profiles = {};
  for (const symbol of symbols) {
    try {
      // tiny delay reduces 429 risk on mobile/WKWebView
      await new Promise((r) => setTimeout(r, 80));
      const p = await getCompanyProfile(symbol);
      profiles[symbol] = p;
    } catch (_) {
      profiles[symbol] = {
        symbol,
        name: symbol,
        logo: null,
        marketCap: null,
      };
    }
  }
  return profiles;
}

async function refreshEarningsIfNeeded() {
  const { monday, friday } = getCurrentWeekRangeEst();

  // Use NY-local YYYY-MM-DD for the API query (not UTC slice)
  const fromIso = fmtNYDateYYYYMMDD(monday);
  const toIso = fmtNYDateYYYYMMDD(friday);

  const weekKey = makeWeekKey(fromIso);
  const nowIso = toEstIso(new Date());

  // Cache freshness check (NY)
  if (
    earningsState.weekKey === weekKey &&
    earningsState.lastFetch &&
    !isOlderThanMinutes(
      earningsState.lastFetch,
      EARNINGS_REFRESH_MINUTES,
      'America/New_York'
    ) &&
    earningsState.dataByDay
  ) {
    return;
  }

  earningsState.status = 'loading';
  earningsState.error = null;

  let raw;
  try {
    // Single Finnhub call (your goal)
    raw = await apiClient.finnhub(
      `/calendar/earnings?from=${fromIso}&to=${toIso}`
    );
  } catch (err) {
    earningsState.status = 'error';
    earningsState.error = err.message;
    throw err;
  }

  const allEntries = dedupeEntries(raw.earningsCalendar || []);

  // Filter to your important universe (your goal)
  const filteredEntries = allEntries.filter((e) =>
    IMPORTANT_SET.has(String(e.symbol || '').toUpperCase())
  );

  if (!filteredEntries.length) {
    earningsState.weekKey = weekKey;
    earningsState.dataByDay = emptyWeekStruct();
    earningsState.lastFetch = nowIso;
    earningsState.status = 'ready';
    saveCache();
    return;
  }

  // ---- KEY CHANGE ----
  // Select "top 30" BEFORE doing any profile calls, using IMPORTANT_TICKERS rank.
  // This prevents rate-limited profiles from nuking marketCap sorting.
  const ranked = [...filteredEntries].sort((a, b) => {
    const ra = rankOf(a.symbol);
    const rb = rankOf(b.symbol);
    if (ra !== rb) return ra - rb;
    // tie-breaker: earlier date first, then BMO before AMC
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return da.localeCompare(db);
    return String(a.hour || '').localeCompare(String(b.hour || ''));
  });

  // Take a small buffer so MIN_MARKET_CAP filter doesn’t shrink the week too much
  const PRESELECT = Math.max(MAX_EARNINGS_COUNT, 40);
  const preselected = ranked.slice(0, PRESELECT);

  // Profiles only for preselected symbols (<= 40 calls, usually cached)
  const symbolsNeeded = Array.from(
    new Set(preselected.map((e) => String(e.symbol || '').toUpperCase()))
  );

  const profiles = await fetchProfilesForSymbolsLimited(symbolsNeeded);

  // Apply cap filter (keep unknowns), then cap to 30
  const decorated = preselected.map((e) => {
    const key = String(e.symbol || '').toUpperCase();
    const profile = profiles[key] || {
      symbol: key,
      name: key,
      logo: null,
      marketCap: null,
    };
    return { entry: e, profile };
  });

  const filteredByCap = decorated.filter((d) => {
    const cap = d.profile.marketCap;
    if (cap == null || Number.isNaN(cap)) return true; // keep unknowns
    return cap >= MIN_MARKET_CAP;
  });

  // Final ordering: IMPORTANT rank first (so big names always show),
  // not marketCap (which can be null under rate limits)
  filteredByCap.sort((a, b) => {
    const ra = rankOf(a.entry.symbol);
    const rb = rankOf(b.entry.symbol);
    if (ra !== rb) return ra - rb;
    const ca = typeof a.profile.marketCap === 'number' ? a.profile.marketCap : -1;
    const cb = typeof b.profile.marketCap === 'number' ? b.profile.marketCap : -1;
    return cb - ca;
  });

  const finalList = filteredByCap.slice(0, MAX_EARNINGS_COUNT);

  const grouped = emptyWeekStruct();

  for (const { entry: e, profile } of finalList) {
    const dayName = weekdayNameFromDate(e.date);
    if (!dayName || !grouped[dayName]) continue;

    const session = sessionFromHour(e.hour);

    grouped[dayName][session].push({
      symbol: String(e.symbol || '').toUpperCase(),
      companyName: profile.name,
      logo: profile.logo,
      date: e.date,
      hour: e.hour,
      epsActual: e.epsActual,
      epsEstimate: e.epsEstimate,
      revenueActual: e.revenueActual,
      revenueEstimate: e.revenueEstimate,
    });
  }

  earningsState.weekKey = weekKey;
  earningsState.dataByDay = grouped;
  earningsState.lastFetch = nowIso;
  earningsState.status = 'ready';
  saveCache();
}

export async function getWeeklyEarnings() {
  try {
    await refreshEarningsIfNeeded();
  } catch (_) {}

  return {
    dataByDay: earningsState.dataByDay || emptyWeekStruct(),
    lastFetch: earningsState.lastFetch,
    status: earningsState.status,
    error: earningsState.error,
  };
}

export function resetEarningsCache() {
  try {
    localStorage.removeItem(STORAGE_KEYS.earningsCache);
  } catch (_) {}
  earningsState = {
    weekKey: null,
    dataByDay: null,
    lastFetch: null,
    status: 'idle',
    error: null,
  };
}
