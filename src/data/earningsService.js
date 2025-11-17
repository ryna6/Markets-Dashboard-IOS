// src/data/earningsService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, getCurrentWeekRangeEst, isOlderThanMinutes } from './timezone.js';
import { getCompanyProfile } from './companyService.js';

const EARNINGS_REFRESH_MINUTES = 60 * 24; // refresh at most once/day

let earningsState = {
  weekKey: null,            // 'YYYY-WW'
  dataByDay: null,          // structured calendar
  lastFetch: null,
  status: 'idle',
  error: null
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.earningsCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    earningsState = { ...earningsState, ...parsed };
  } catch (_) {}
}

function saveCache() {
  const snapshot = {
    weekKey: earningsState.weekKey,
    dataByDay: earningsState.dataByDay,
    lastFetch: earningsState.lastFetch
  };
  localStorage.setItem(STORAGE_KEYS.earningsCache, JSON.stringify(snapshot));
}

loadCache();

function makeWeekKey(weekStartIso) {
  // e.g., '2025-03-03' -> '2025-10' (year-weekNumber)
  const d = new Date(weekStartIso);
  const year = d.getUTCFullYear();
  const oneJan = new Date(Date.UTC(year, 0, 1));
  const diff = d - oneJan;
  const week = Math.ceil((diff / 86400000 + oneJan.getUTCDay() + 1) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function initEmptyWeekStruct() {
  const base = {};
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(day => {
    base[day] = {
      BMO: [],
      AMC: []
    };
  });
  return base;
}

function weekdayNameFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayIdx = d.getUTCDay(); // 0=Sun ... 6=Sat
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
  if (!hour) return 'AMC'; // default
  const norm = hour.toLowerCase();
  if (norm === 'bmo') return 'BMO';
  if (norm === 'amc') return 'AMC';
  // Fallback heuristic
  return 'AMC';
}

async function refreshEarningsIfNeeded() {
  const { monday, friday } = getCurrentWeekRangeEst();
  const weekStartIso = monday.toISOString().slice(0, 10);
  const weekEndIso = friday.toISOString().slice(0, 10);
  const weekKey = makeWeekKey(weekStartIso);

  const nowIso = toEstIso(new Date());

  if (
    earningsState.weekKey === weekKey &&
    earningsState.lastFetch &&
    !isOlderThanMinutes(earningsState.lastFetch, EARNINGS_REFRESH_MINUTES, 'America/New_York') &&
    earningsState.dataByDay
  ) {
    return; // still fresh
  }

  earningsState.status = 'loading';
  earningsState.error = null;

  let raw;
  try {
    raw = await apiClient.finnhub(
      `/calendar/earnings?from=${weekStartIso}&to=${weekEndIso}`
    );
    // raw: { earningsCalendar: [ { date, symbol, hour, ... } ] }
  } catch (err) {
    earningsState.status = 'error';
    earningsState.error = err.message;
    throw err;
  }

  const entries = raw.earningsCalendar || [];
  const grouped = initEmptyWeekStruct();

  // First collect all symbols (for batch profile/logo fetch)
  const symbolsSet = new Set(entries.map(e => e.symbol));
  const profiles = {};

  for (const symbol of symbolsSet) {
    if (!symbol) continue;
    try {
      profiles[symbol] = await getCompanyProfile(symbol);
    } catch (_) {
      profiles[symbol] = { name: symbol, logo: null };
    }
  }

  for (const e of entries) {
    const dayName = weekdayNameFromDate(e.date);
    if (!dayName || !grouped[dayName]) continue;

    const session = sessionFromHour(e.hour);
    const profile = profiles[e.symbol] || { name: e.symbol, logo: null };

    grouped[dayName][session].push({
      symbol: e.symbol,
      companyName: profile.name,
      logo: profile.logo,
      date: e.date,
      hour: e.hour,
      epsActual: e.epsActual,
      epsEstimate: e.epsEstimate,
      revenueActual: e.revenueActual,
      revenueEstimate: e.revenueEstimate
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
    dataByDay: earningsState.dataByDay || initEmptyWeekStruct(),
    lastFetch: earningsState.lastFetch,
    status: earningsState.status,
    error: earningsState.error
  };
}
