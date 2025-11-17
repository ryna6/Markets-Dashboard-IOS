// src/data/earningsService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, getCurrentWeekRangeEst, isOlderThanMinutes, } from './timezone.js';
import { getCompanyProfile } from './companyService.js';
import { IMPORTANT_TICKERS } from './importantTickers.js';

// Market cap threshold: only show companies above this.
// You can adjust based on Finnhub's units; start with ~10 or 20 if they are billions.
const MIN_MARKET_CAP = 5; // e.g. 10 (if Finnhub uses billions), tweak after you inspect values

// Also cap the total number of earnings shown in a week as a secondary safety.
const MAX_EARNINGS_COUNT = 30;

const EARNINGS_REFRESH_MINUTES = 60 * 24; // at most once/day per week

let earningsState = {
  weekKey: null,     // e.g. '2025-47'
  dataByDay: null,   // { Monday: { BMO: [], AMC: [] }, ... }
  lastFetch: null,
  status: 'idle',
  error: null,
};

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
    case 1:
      return 'Monday';
    case 2:
      return 'Tuesday';
    case 3:
      return 'Wednesday';
    case 4:
      return 'Thursday';
    case 5:
      return 'Friday';
    default:
      return null;
  }
}

function sessionFromHour(hour) {
  if (!hour) return 'AMC'; // default
  const norm = hour.toLowerCase();
  if (norm === 'bmo') return 'BMO';
  if (norm === 'amc') return 'AMC';
  return 'AMC';
}

// Optionally, a simple no-throttle profile fetch.
// If you want throttling, we can enhance this later.
async function fetchProfilesForSymbols(symbolSet) {
  const profiles = {};
  for (const symbol of symbolSet) {
    try {
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
  const fromIso = monday.toISOString().slice(0, 10);
  const toIso = friday.toISOString().slice(0, 10);
  const weekKey = makeWeekKey(fromIso);
  const nowIso = toEstIso(new Date());

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
    raw = await apiClient.finnhub(
      `/calendar/earnings?from=${fromIso}&to=${toIso}`
    );
  } catch (err) {
    earningsState.status = 'error';
    earningsState.error = err.message;
    throw err;
  }

  const allEntries = raw.earningsCalendar || [];

  // STEP 1: filter entries by your important ticker universe
  const importantSet = new Set(
    IMPORTANT_TICKERS.map((t) => t.toUpperCase())
  );

  const filteredEntries = allEntries.filter((e) =>
    importantSet.has((e.symbol || '').toUpperCase())
  );

  if (!filteredEntries.length) {
    earningsState.weekKey = weekKey;
    earningsState.dataByDay = emptyWeekStruct();
    earningsState.lastFetch = nowIso;
    earningsState.status = 'ready';
    saveCache();
    return;
  }

  // STEP 2: fetch profiles for these filtered symbols to get marketCap/logo
  const symbolSet = new Set(
    filteredEntries.map((e) => (e.symbol || '').toUpperCase())
  );
  const profiles = await fetchProfilesForSymbols(symbolSet);

  // STEP 3: further filter by market cap (if we have it)
  const decorated = filteredEntries.map((e) => {
    const key = (e.symbol || '').toUpperCase();
    const profile = profiles[key] || {
      symbol: key,
      name: key,
      logo: null,
      marketCap: null,
    };
    return { entry: e, profile };
  });

  let filteredByCap = decorated.filter((d) => {
    const cap = d.profile.marketCap;
    if (cap == null || Number.isNaN(cap)) {
      // If cap unknown, you can decide whether to keep or drop.
      // Here we keep unknowns so you don't silently miss big names.
      return true;
    }
    return cap >= MIN_MARKET_CAP;
  });

  // STEP 4: sort by marketCap descending and cap the total count for the week
  filteredByCap.sort(
    (a, b) =>
      (b.profile.marketCap || 0) - (a.profile.marketCap || 0)
  );

  const finalList = filteredByCap.slice(0, MAX_EARNINGS_COUNT);

  const grouped = emptyWeekStruct();

  for (const { entry: e, profile } of finalList) {
    const dayName = weekdayNameFromDate(e.date);
    if (!dayName || !grouped[dayName]) continue;

    const session = sessionFromHour(e.hour);

    grouped[dayName][session].push({
      symbol: e.symbol,
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
