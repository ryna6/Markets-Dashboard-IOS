// src/data/sectorService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';
import { getCompanyProfile } from './companyService.js';

const SECTOR_REFRESH_MINUTES = 10;
const SECTOR_WEEKLY_REFRESH_MINUTES = 60 * 12;

// Fixed list of SPDR sector ETFs
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
  { symbol: 'XLP', name: 'Consumer Staples' }
];

let sectorState = {
  sectors: SECTOR_LIST,
  quotes: {},          // symbol -> { price, changePct1D }
  weeklyChange: {},    // symbol -> { changePct1W }
  marketCaps: {},      // symbol -> number (ETF AUM proxy)
  lastQuotesFetch: null,
  lastWeeklyFetch: null,
  status: 'idle',
  error: null
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.sectorCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sectorState = { ...sectorState, ...parsed };
  } catch (_) {}
}

function saveCache() {
  const snapshot = {
    sectors: sectorState.sectors,
    quotes: sectorState.quotes,
    weeklyChange: sectorState.weeklyChange,
    marketCaps: sectorState.marketCaps,
    lastQuotesFetch: sectorState.lastQuotesFetch,
    lastWeeklyFetch: sectorState.lastWeeklyFetch
  };
  localStorage.setItem(STORAGE_KEYS.sectorCache, JSON.stringify(snapshot));
}

loadCache();

function getSectorSymbols() {
  return sectorState.sectors.map(s => s.symbol);
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
  if (!symbols.length) return;

  const quotes = { ...sectorState.quotes };

  for (const symbol of symbols) {
    try {
      const data = await apiClient.finnhub(
        `/quote?symbol=${encodeURIComponent(symbol)}`
      );
      quotes[symbol] = {
        price: data.c,
        changePct1D: data.dp
      };
    } catch (_) {
      continue;
    }
  }

  sectorState.quotes = quotes;
  sectorState.lastQuotesFetch = nowEstIso;
  sectorState.status = 'ready';
  saveCache();
}

async function refreshSectorWeeklyIfNeeded() {
  const nowEstIso = toEstIso(new Date());
  if (
    sectorState.lastWeeklyFetch &&
    !isOlderThanMinutes(
      sectorState.lastWeeklyFetch,
      SECTOR_WEEKLY_REFRESH_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  const symbols = getSectorSymbols();
  if (!symbols.length) return;

  const weeklyChange = { ...sectorState.weeklyChange };

  const nowSec = Math.floor(Date.now() / 1000);
  const weekAgoSec = nowSec - 7 * 24 * 60 * 60;

  for (const symbol of symbols) {
    try {
      const data = await apiClient.finnhub(
        `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${weekAgoSec}&to=${nowSec}`
      );
      if (data.s !== 'ok' || !data.c || data.c.length < 2) continue;

      const closes = data.c;
      const latest = closes[closes.length - 1];
      const weekAgo = closes[0];
      if (!weekAgo) continue;

      const pct = ((latest - weekAgo) / weekAgo) * 100;
      weeklyChange[symbol] = { changePct1W: pct };
    } catch (_) {
      continue;
    }
  }

  sectorState.weeklyChange = weeklyChange;
  sectorState.lastWeeklyFetch = nowEstIso;
  saveCache();
}

async function refreshSectorMarketCapsIfNeeded() {
  const symbols = getSectorSymbols();
  if (!symbols.length) return;

  const marketCaps = { ...sectorState.marketCaps };

  for (const symbol of symbols) {
    if (marketCaps[symbol] != null) continue;
    try {
      const profile = await getCompanyProfile(symbol);
      if (profile.marketCap != null) {
        marketCaps[symbol] = profile.marketCap;
      }
    } catch (_) {
      continue;
    }
  }

  sectorState.marketCaps = marketCaps;
  saveCache();
}

/**
 * Public API used by sectorHeatmap.js
 * timeframe: '1D' | '1W'
 */
export async function getSectorData(timeframe) {
  try {
    await refreshSectorQuotesIfNeeded();
  } catch (_) {}

  if (timeframe === '1W') {
    try {
      await refreshSectorWeeklyIfNeeded();
    } catch (_) {}
  }

  try {
    await refreshSectorMarketCapsIfNeeded();
  } catch (_) {}

  return {
    sectors: sectorState.sectors,
    quotes: sectorState.quotes,
    weeklyChange: sectorState.weeklyChange,
    marketCaps: sectorState.marketCaps,
    lastQuotesFetch: sectorState.lastQuotesFetch,
    status: sectorState.status,
    error: sectorState.error
  };
}
