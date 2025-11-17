// src/data/sectorService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';

const SECTOR_REFRESH_MINUTES = 10;
const SECTOR_WEEKLY_RECALC_MINUTES = 60;

// SPDR sector ETFs
const SECTOR_LIST = [
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLY', name: 'Consumer Discretionary' },
  { symbol: 'XLV', name: 'Health Care' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLC', name: 'Communication Services' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLP', name: 'Consumer Staples' },
];

// Static weights for treemap sizing
const SECTOR_WEIGHTS = {
  XLK: 34.0,
  XLF: 13.8,
  XLY: 10.4,
  XLC: 9.9,
  XLV: 8.8,
  XLI: 8.6,
  XLP: 5.2,
  XLE: 3.0,
  XLU: 2.5,
  XLRE: 2.0,
  XLB: 1.9,
};

let sectorState = {
  sectors: SECTOR_LIST,
  quotes: {},          // symbol -> { price, changePct1D }
  weeklyChange: {},    // symbol -> { changePct1W }
  priceHistory: {},    // symbol -> [{ date, close }]
  lastQuotesFetch: null,
  lastWeeklyCalc: null,
  status: 'idle',
  error: null,
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.sectorCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sectorState.quotes = parsed.quotes || sectorState.quotes;
    sectorState.weeklyChange = parsed.weeklyChange || sectorState.weeklyChange;
    sectorState.lastQuotesFetch = parsed.lastQuotesFetch || null;
  } catch (_) {
    // ignore
  }
}

function loadHistory() {
  const raw = localStorage.getItem(STORAGE_KEYS.sectorHistory);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sectorState.priceHistory = parsed.priceHistory || {};
    sectorState.lastWeeklyCalc = parsed.lastWeeklyCalc || null;
  } catch (_) {
    // ignore
  }
}

function saveCache() {
  const snapshot = {
    quotes: sectorState.quotes,
    weeklyChange: sectorState.weeklyChange,
    lastQuotesFetch: sectorState.lastQuotesFetch,
  };
  localStorage.setItem(STORAGE_KEYS.sectorCache, JSON.stringify(snapshot));
}

function saveHistory() {
  const snapshot = {
    priceHistory: sectorState.priceHistory,
    lastWeeklyCalc: sectorState.lastWeeklyCalc,
  };
  localStorage.setItem(STORAGE_KEYS.sectorHistory, JSON.stringify(snapshot));
}

loadCache();
loadHistory();

function getSectorSymbols() {
  return sectorState.sectors.map((s) => s.symbol);
}

function getTodayEstDate() {
  const estIso = toEstIso(new Date());
  return estIso.slice(0, 10);
}

function isWeekendDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

function updateHistoryFromQuotes(quotes) {
  const today = getTodayEstDate();
  if (isWeekendDate(today)) {
    // Don't store weekend samples
    return;
  }

  const history = sectorState.priceHistory || {};

  Object.entries(quotes).forEach(([symbol, q]) => {
    const close =
      q && typeof q.price === 'number'
        ? q.price
        : null;
    if (close == null) return;

    const sym = symbol.toUpperCase();
    const arr = Array.isArray(history[sym]) ? history[sym] : [];
    const last = arr[arr.length - 1];

    if (last && last.date === today) {
      last.close = close;
    } else {
      arr.push({ date: today, close });
    }

    // Drop entries older than 14 days
    const cutoff = new Date(today + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtered = arr.filter((entry) => entry.date >= cutoffStr);

    // Hard cap
    while (filtered.length > 10) {
      filtered.shift();
    }

    history[sym] = filtered;
  });

  sectorState.priceHistory = history;
}

async function refreshSectorQuotesIfNeeded() {
  const nowEstIso = toEstIso(new Date());

  if (
    sectorState.lastQuotesFetch &&
    !isOlderThanMinutes(
      sectorState.lastQuotesFetch,
      SECTOR_REFRESH_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  sectorState.status = 'loading';
  sectorState.error = null;

  const symbols = getSectorSymbols();
  const quotes = {};

  for (const symbol of symbols) {
    try {
      const data = await apiClient.finnhub(
        `/quote?symbol=${encodeURIComponent(symbol)}`
      );

      const price = data.c;
      let pct1D =
        typeof data.dp === 'number'
          ? data.dp
          : typeof data.c === 'number' &&
            typeof data.pc === 'number' &&
            data.pc !== 0
          ? ((data.c - data.pc) / data.pc) * 100
          : null;

      quotes[symbol] = {
        price,
        changePct1D: pct1D,
      };
    } catch (err) {
      console.warn('Sector quote error', symbol, err);
    }
  }

  sectorState.quotes = quotes;
  sectorState.lastQuotesFetch = nowEstIso;
  sectorState.status = 'ready';

  updateHistoryFromQuotes(quotes);
  saveCache();
  saveHistory();
}

async function refreshSectorWeeklyIfNeeded() {
  const nowEstIso = toEstIso(new Date());

  if (
    sectorState.lastWeeklyCalc &&
    !isOlderThanMinutes(
      sectorState.lastWeeklyCalc,
      SECTOR_WEEKLY_RECALC_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  const history = sectorState.priceHistory || {};
  const weeklyChange = {};

  Object.entries(history).forEach(([symbol, arr]) => {
    if (!Array.isArray(arr) || arr.length < 2) return;

    const latest = arr[arr.length - 1];
    const lookbackIndex = Math.max(0, arr.length - 5);
    const older = arr[lookbackIndex];

    if (
      !older ||
      typeof older.close !== 'number' ||
      typeof latest.close !== 'number' ||
      older.close === 0
    ) {
      return;
    }

    const pct = ((latest.close - older.close) / older.close) * 100;
    weeklyChange[symbol] = { changePct1W: pct };
  });

  sectorState.weeklyChange = weeklyChange;
  sectorState.lastWeeklyCalc = nowEstIso;
  saveCache();
  saveHistory();
}

export async function getSectorData(timeframe) {
  try {
    await refreshSectorQuotesIfNeeded();
  } catch (err) {
    sectorState.error = err.message;
  }

  if (timeframe === '1W') {
    try {
      await refreshSectorWeeklyIfNeeded();
    } catch (err) {
      sectorState.error = err.message;
    }
  }

  return {
    sectors: sectorState.sectors,
    quotes: sectorState.quotes,
    weeklyChange: sectorState.weeklyChange,
    marketCaps: SECTOR_WEIGHTS,
    lastQuotesFetch: sectorState.lastQuotesFetch,
    status: sectorState.status,
    error: sectorState.error,
  };
}

export function resetSectorCache() {
  // Clear only the cache, preserve history
  try {
    localStorage.removeItem(STORAGE_KEYS.sectorCache);
  } catch (_) {
    // ignore
  }

  const preservedHistory = sectorState.priceHistory || {};
  const preservedLastWeeklyCalc = sectorState.lastWeeklyCalc || null;

  sectorState = {
    sectors: SECTOR_LIST,
    quotes: {},
    weeklyChange: {},
    priceHistory: preservedHistory,    // keep history
    lastQuotesFetch: null,
    lastWeeklyCalc: preservedLastWeeklyCalc,
    status: 'idle',
    error: null,
  };
}
