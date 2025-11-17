// src/data/stocksService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';
import { SP500_SYMBOLS } from './sp500-constituents.js';
import { getCompanyProfile } from './companyService.js';

const SP500_REFRESH_MINUTES = 10;                 // quotes refresh cadence
const SP500_WEEKLY_RECALC_MINUTES = 60;          // recompute 1W from history at most once/hour
const SP500_MARKETCAP_TTL_MINUTES = 60 * 24 * 7; // 1 week for market caps

let sp500State = {
  symbols: SP500_SYMBOLS.slice(), // S&P universe (or your subset)
  quotes: {},                     // symbol -> { price, changePct1D }
  weeklyChange: {},               // symbol -> { changePct1W }
  priceHistory: {},               // symbol -> [{ date: 'YYYY-MM-DD', close }]
  marketCaps: {},                 // symbol -> number
  lastQuotesFetch: null,
  lastWeeklyCalc: null,
  lastMarketCapFetch: null,
  status: 'idle',
  error: null,
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.sp500Cache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sp500State.symbols = parsed.symbols || sp500State.symbols;
    sp500State.quotes = parsed.quotes || {};
    sp500State.weeklyChange = parsed.weeklyChange || {};
    sp500State.marketCaps = parsed.marketCaps || {};
    sp500State.lastQuotesFetch = parsed.lastQuotesFetch || null;
    sp500State.lastMarketCapFetch = parsed.lastMarketCapFetch || null;
  } catch (_) {
    // ignore
  }
}

function loadHistory() {
  const raw = localStorage.getItem(STORAGE_KEYS.sp500History);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sp500State.priceHistory = parsed.priceHistory || {};
    sp500State.lastWeeklyCalc = parsed.lastWeeklyCalc || null;
  } catch (_) {
    // ignore
  }
}

function saveCache() {
  const snapshot = {
    symbols: sp500State.symbols,
    quotes: sp500State.quotes,
    weeklyChange: sp500State.weeklyChange,
    marketCaps: sp500State.marketCaps,
    lastQuotesFetch: sp500State.lastQuotesFetch,
    lastMarketCapFetch: sp500State.lastMarketCapFetch,
  };
  localStorage.setItem(STORAGE_KEYS.sp500Cache, JSON.stringify(snapshot));
}

function saveHistory() {
  const snapshot = {
    priceHistory: sp500State.priceHistory,
    lastWeeklyCalc: sp500State.lastWeeklyCalc,
  };
  localStorage.setItem(STORAGE_KEYS.sp500History, JSON.stringify(snapshot));
}

loadCache();
loadHistory();

function getTodayEstDate() {
  const estIso = toEstIso(new Date()); // "YYYY-MM-DDTHH:mm:ss"
  return estIso.slice(0, 10);
}

function isWeekendDate(dateStr) {
  // dateStr is 'YYYY-MM-DD'
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

// Update per-symbol daily close history from latest quotes (trading days only)
function updateHistoryFromQuotes(quotes) {
  const today = getTodayEstDate();
  if (isWeekendDate(today)) {
    // Don't record weekend samples for stocks/ETFs
    return;
  }

  const history = sp500State.priceHistory || {};

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
      // Update today's close
      last.close = close;
    } else {
      // Add new daily sample
      arr.push({ date: today, close });
    }

    // Drop anything older than 14 days
    const cutoff = new Date(today + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtered = arr.filter((entry) => entry.date >= cutoffStr);

    // Hard cap to avoid any pathological growth
    while (filtered.length > 10) {
      filtered.shift();
    }

    history[sym] = filtered;
  });

  sp500State.priceHistory = history;
}

// ----------------- 1D quotes via Finnhub /quote --------------------------

async function refreshQuotesIfNeeded() {
  const nowEstIso = toEstIso(new Date());
  if (
    sp500State.lastQuotesFetch &&
    !isOlderThanMinutes(
      sp500State.lastQuotesFetch,
      SP500_REFRESH_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  sp500State.status = 'loading';
  sp500State.error = null;

  const symbols = sp500State.symbols;
  const quotes = {};

  // NOTE: This is one call per symbol. Keep your S&P universe size reasonable.
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
      console.warn('SP500 quote error', symbol, err);
    }
  }

  sp500State.quotes = quotes;
  sp500State.lastQuotesFetch = nowEstIso;
  sp500State.status = 'ready';

  // Update local daily close history and save
  updateHistoryFromQuotes(quotes);
  saveCache();
  saveHistory();
}

// ----------------- 1W change computed from local history -----------------

async function refreshWeeklyIfNeeded() {
  const nowEstIso = toEstIso(new Date());

  if (
    sp500State.lastWeeklyCalc &&
    !isOlderThanMinutes(
      sp500State.lastWeeklyCalc,
      SP500_WEEKLY_RECALC_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  const history = sp500State.priceHistory || {};
  const weeklyChange = {};

  Object.entries(history).forEach(([symbol, arr]) => {
    if (!Array.isArray(arr) || arr.length < 2) return;

    const latest = arr[arr.length - 1];
    // Approx 1 trading week: up to 5 samples back
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

  sp500State.weeklyChange = weeklyChange;
  sp500State.lastWeeklyCalc = nowEstIso;
  saveCache();
  saveHistory();
}

// ----------------- Market caps for tile sizing via profile ---------------

async function refreshMarketCapsIfNeeded() {
  const nowEstIso = toEstIso(new Date());

  if (
    sp500State.lastMarketCapFetch &&
    !isOlderThanMinutes(
      sp500State.lastMarketCapFetch,
      SP500_MARKETCAP_TTL_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  const marketCaps = { ...sp500State.marketCaps };

  for (const symbol of sp500State.symbols) {
    if (marketCaps[symbol] != null) continue;
    try {
      const profile = await getCompanyProfile(symbol);
      if (profile && typeof profile.marketCap === 'number') {
        marketCaps[symbol] = profile.marketCap;
      }
    } catch (err) {
      console.warn('SP500 marketCap error', symbol, err);
    }
  }

  sp500State.marketCaps = marketCaps;
  sp500State.lastMarketCapFetch = nowEstIso;
  saveCache();
}

// ----------------- Public API used by sp500Heatmap -----------------------

export async function getSp500Data(timeframe) {
  try {
    await refreshQuotesIfNeeded();
  } catch (_) {
    // keep last cache
  }

  if (timeframe === '1W') {
    try {
      await refreshWeeklyIfNeeded();
    } catch (_) {}
  }

  try {
    await refreshMarketCapsIfNeeded();
  } catch (_) {}

  return {
    symbols: sp500State.symbols,
    quotes: sp500State.quotes,
    weeklyChange: sp500State.weeklyChange,
    marketCaps: sp500State.marketCaps,
    lastQuotesFetch: sp500State.lastQuotesFetch,
    status: sp500State.status,
    error: sp500State.error,
  };
}

export function resetSp500Cache() {
  // Clear only the *cache*, not the history
  try {
    localStorage.removeItem(STORAGE_KEYS.sp500Cache);
  } catch (_) {
    // ignore
  }

  const preservedHistory = sp500State.priceHistory || {};
  const preservedLastWeeklyCalc = sp500State.lastWeeklyCalc || null;

  sp500State = {
    symbols: SP500_SYMBOLS.slice(),
    quotes: {},
    weeklyChange: {},
    priceHistory: preservedHistory,      // keep history
    marketCaps: {},
    lastQuotesFetch: null,
    lastWeeklyCalc: preservedLastWeeklyCalc,
    lastMarketCapFetch: null,
    status: 'idle',
    error: null,
  };
}
