// src/data/stocksService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';
import { SP500_SYMBOLS } from './sp500-constituents.js';
import { getCompanyProfile } from './companyService.js';

const SP500_REFRESH_MINUTES = 10;
const WEEKLY_REFRESH_MINUTES = 60 * 12; // 12 hours

let sp500State = {
  symbols: [],
  quotes: {},           // symbol -> { price, changePct1D }
  weeklyChange: {},     // symbol -> { changePct1W }
  marketCaps: {},       // symbol -> number
  lastQuotesFetch: null,
  lastWeeklyFetch: null,
  status: 'idle',
  error: null
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.sp500Cache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sp500State = { ...sp500State, ...parsed };
  } catch (_) {}
}

function saveCache() {
  const snapshot = {
    symbols: sp500State.symbols,
    quotes: sp500State.quotes,
    weeklyChange: sp500State.weeklyChange,
    marketCaps: sp500State.marketCaps,
    lastQuotesFetch: sp500State.lastQuotesFetch,
    lastWeeklyFetch: sp500State.lastWeeklyFetch
  };
  localStorage.setItem(STORAGE_KEYS.sp500Cache, JSON.stringify(snapshot));
}

loadCache();

async function fetchSp500SymbolsIfNeeded() {
  if (sp500State.symbols.length) return sp500State.symbols;

  // Use your curated S&P list; keep it limited to ~50–100 to stay comfy on free tier
  sp500State.symbols = SP500_SYMBOLS.slice();
  saveCache();
  return sp500State.symbols;
}

// Finnhub quote: 1D change
async function refreshQuotesIfNeeded() {
  const nowEstIso = toEstIso(new Date());
  if (
    sp500State.lastQuotesFetch &&
    !isOlderThanMinutes(sp500State.lastQuotesFetch, SP500_REFRESH_MINUTES, 'America/New_York')
  ) {
    return;
  }

  sp500State.status = 'loading';
  sp500State.error = null;

  const symbols = await fetchSp500SymbolsIfNeeded();
  if (!symbols.length) return;

  const quotes = { ...sp500State.quotes };

  // Sequential per-symbol calls: fine for a small S&P subset on free tier
  for (const symbol of symbols) {
    try {
      const data = await apiClient.finnhub(
        `/quote?symbol=${encodeURIComponent(symbol)}`
      );
      // data: { c, d, dp, h, l, o, pc, t } 
      quotes[symbol] = {
        price: data.c,
        changePct1D: data.dp
      };
    } catch (err) {
      // keep previous quote if any
      continue;
    }
  }

  sp500State.quotes = quotes;
  sp500State.lastQuotesFetch = nowEstIso;
  sp500State.status = 'ready';
  saveCache();
}

// Finnhub candles: 1W change from last close vs close ~5–7 days ago
async function refreshWeeklyIfNeeded() {
  const nowEstIso = toEstIso(new Date());
  if (
    sp500State.lastWeeklyFetch &&
    !isOlderThanMinutes(sp500State.lastWeeklyFetch, WEEKLY_REFRESH_MINUTES, 'America/New_York')
  ) {
    return;
  }

  const symbols = await fetchSp500SymbolsIfNeeded();
  if (!symbols.length) return;

  const weeklyChange = { ...sp500State.weeklyChange };

  // From ~7 calendar days ago to now
  const nowSec = Math.floor(Date.now() / 1000);
  const weekAgoSec = nowSec - 7 * 24 * 60 * 60;

  for (const symbol of symbols) {
    try {
      const data = await apiClient.finnhub(
        `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${weekAgoSec}&to=${nowSec}`
      );
      // data: { c: [], t: [], s: 'ok'|'no_data', ... } 
      if (data.s !== 'ok' || !data.c || data.c.length < 2) continue;

      const closes = data.c;
      const latest = closes[closes.length - 1];
      const weekAgo = closes[0];
      if (!weekAgo) continue;

      const pct = ((latest - weekAgo) / weekAgo) * 100;
      weeklyChange[symbol] = { changePct1W: pct };
    } catch (err) {
      continue;
    }
  }

  sp500State.weeklyChange = weeklyChange;
  sp500State.lastWeeklyFetch = nowEstIso;
  saveCache();
}

// Market caps via company profile2
async function refreshMarketCapsIfNeeded() {
  const symbols = await fetchSp500SymbolsIfNeeded();
  if (!symbols.length) return;

  const marketCaps = { ...sp500State.marketCaps };

  for (const symbol of symbols) {
    const existing = marketCaps[symbol];
    // We'll let companyService handle actual staleness; we just make sure we fetched once
    if (existing != null) continue;

    try {
      const profile = await getCompanyProfile(symbol);
      if (profile.marketCap != null) {
        marketCaps[symbol] = profile.marketCap;
      }
    } catch (_) {
      continue;
    }
  }

  sp500State.marketCaps = marketCaps;
  saveCache();
}

export async function getSp500Data(timeframe) {
  try {
    await refreshQuotesIfNeeded();
  } catch (_) {}

  if (timeframe === '1W') {
    try {
      await refreshWeeklyIfNeeded();
    } catch (_) {}
  }

  // market caps used for tile sizing
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
    error: sp500State.error
  };
}
