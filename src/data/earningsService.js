// src/data/earningsService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, getCurrentWeekRangeEst, isOlderThanMinutes, } from './timezone.js';
import { getCompanyProfile } from './companyService.js';

// How many earnings to show per week (biggest by market cap)
const MAX_EARNINGS_COUNT = 20;
const EARNINGS_REFRESH_MINUTES = 60 * 24; // refresh at most once per day per week

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

  const entries = raw.earningsCalendar || [];
  if (!entries.length) {
    earningsState.weekKey = weekKey;
    earningsState.dataByDay = emptyWeekStruct();
    earningsState.lastFetch = nowIso;
    earningsState.status = 'ready';
    saveCache();
    return;
  }

  // Fetch profiles / market caps once per symbol
  const symbolSet = new Set(entries.map((e) => e.symbol).filter(Boolean));
  const profiles = {};

  for (const symbol of symbolSet) {
    try {
      profiles[symbol] = await getCompanyProfile(symbol);
    } catch (_) {
      profiles[symbol] = {
        symbol,
        name: symbol,
        logo: null,
        marketCap: null,
      };
    }
  }

  // Decorate entries with marketCap, then sort + pick top N
  const decorated = entries.map((e) => {
    const profile = profiles[e.symbol] || {
      symbol: e.symbol,
      name: e.symbol,
      logo: null,
      marketCap: null,
    };
    return { entry: e, profile };
  });

  // Filter out unknown caps first; if we end up with none, fall back to raw entries.
  let withCap = decorated.filter(
    (d) =>
      d.profile.marketCap != null &&
      typeof d.profile.marketCap === 'number' &&
      !Number.isNaN(d.profile.marketCap)
  );

  if (!withCap.length) {
    // No usable caps, just show everything as a fallback.
    withCap = decorated;
  }

  withCap.sort(
    (a, b) =>
      (b.profile.marketCap || 0) - (a.profile.marketCap || 0)
  );

  const top = withCap.slice(0, MAX_EARNINGS_COUNT);

  const grouped = emptyWeekStruct();

  for (const { entry: e, profile } of top) {
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
