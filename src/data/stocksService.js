// src/data/stocksService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';
import { SP500_SYMBOLS } from './sp500-constituents.js';
import { getCompanyProfile } from './companyService.js';

const SP500_REFRESH_MINUTES = 10;           // how often to refresh 1D quotes
const SP500_WEEKLY_REFRESH_MINUTES = 60 * 24; // refresh weekly % at most once/day
const SP500_MARKETCAP_TTL_MINUTES = 60 * 24 * 7; // market caps valid for 1 week

let sp500State = {
  symbols: SP500_SYMBOLS.slice(), // fixed ~100 names
  quotes: {},          // symbol -> { price, changePct1D }
  weeklyChange: {},    // symbol -> { changePct1W }
  marketCaps: {},      // symbol -> number
  lastQuotesFetch: null,
  lastWeeklyFetch: null,
  lastMarketCapFetch: null,
  status: 'idle',
  error: null,
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
    lastWeeklyFetch: sp500State.lastWeeklyFetch,
    lastMarketCapFetch: sp500State.lastMarketCapFetch,
  };
  localStorage.setItem(STORAGE_KEYS.sp500Cache, JSON.stringify(snapshot));
}

loadCache();

function chunkSymbols(symbols, size = 25) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

// ------------------ 1D quotes via FMP batch-quote-short ------------------

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
  const chunks = chunkSymbols(symbols, 25); // ~4 calls for 100 tickers

  try {
    for (const chunk of chunks) {
      const symStr = chunk.join(',');
      const data = await apiClient.fmp(
        `/stable/batch-quote-short?symbols=${encodeURIComponent(symStr)}`
      );

      // Expecting an array like:
      // [{ symbol: 'AAPL', price: 180, change: -1.23, changesPercentage: -0.68 }, ...]
      data.forEach((q) => {
        const sym = q.symbol;
        if (!sym) return;

        const price =
          typeof q.price === 'number'
            ? q.price
            : typeof q.c === 'number'
            ? q.c
            : null;

        let pct1D = null;
        if (typeof q.changesPercentage === 'number') {
          pct1D = q.changesPercentage;
        } else if (typeof q.changePercent === 'number') {
          pct1D = q.changePercent;
        } else if (
          typeof q.change === 'number' &&
          typeof price === 'number' &&
          price !== 0
        ) {
          pct1D = (q.change / (price - q.change)) * 100;
        }

        quotes[sym] = {
          price,
          changePct1D: pct1D,
        };
      });
    }

    sp500State.quotes = quotes;
    sp500State.lastQuotesFetch = nowEstIso;
    sp500State.status = 'ready';
    saveCache();
  } catch (err) {
    sp500State.status = 'error';
    sp500State.error = err.message;
    throw err;
  }
}

// ------------------ 1W % change via FMP historical-price-full ------------

async function refreshWeeklyIfNeeded() {
  const nowEstIso = toEstIso(new Date());

  if (
    sp500State.lastWeeklyFetch &&
    !isOlderThanMinutes(
      sp500State.lastWeeklyFetch,
      SP500_WEEKLY_REFRESH_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  const symbols = sp500State.symbols;
  const weeklyChange = { ...sp500State.weeklyChange };

  for (const symbol of symbols) {
    try {
      // FMP stable historical price endpoint
      const data = await apiClient.fmp(
        `/stable/historical-price-full/${encodeURIComponent(
          symbol
        )}?timeseries=7`
      );

      const hist = Array.isArray(data.historical)
        ? data.historical.slice()
        : [];

      if (hist.length < 2) continue;

      // Make sure ascending by date
      hist.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const weekAgo = hist[0];
      const latest = hist[hist.length - 1];

      if (
        !weekAgo ||
        !latest ||
        typeof weekAgo.close !== 'number' ||
        typeof latest.close !== 'number' ||
        weekAgo.close === 0
      ) {
        continue;
      }

      const pct = ((latest.close - weekAgo.close) / weekAgo.close) * 100;
      weeklyChange[symbol] = { changePct1W: pct };
    } catch (err) {
      console.warn('SP500 weekly FMP error', symbol, err);
    }
  }

  sp500State.weeklyChange = weeklyChange;
  sp500State.lastWeeklyFetch = nowEstIso;
  saveCache();
}

// ------------------ Market caps for tile sizing (still via profiles) -----

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

// ------------------ Public API used by sp500Heatmap.js -------------------

export async function getSp500Data(timeframe) {
  // 1D quotes (FMP)
  try {
    await refreshQuotesIfNeeded();
  } catch (_) {
    // keep last cache
  }

  // 1W changes (FMP)
  if (timeframe === '1W') {
    try {
      await refreshWeeklyIfNeeded();
    } catch (_) {}
  }

  // Market caps for tile sizing (still via profile service)
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
