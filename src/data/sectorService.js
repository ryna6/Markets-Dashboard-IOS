// src/data/sectorService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';

const SECTOR_REFRESH_MINUTES = 10;

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
  XLK: 34.43,
  XLF: 13.40,
  XLY: 10.41,
  XLC: 10.58,
  XLV: 9.59,
  XLI: 8.16,
  XLP: 4.71,
  XLE: 2.81,
  XLU: 2.25,
  XLRE: 1.83,
  XLB: 1.83,
};

// Clean up old history key from previous versions
try {
  localStorage.removeItem('md_sector_history');
} catch (_) {
  // ignore
}

let sectorState = {
  sectors: SECTOR_LIST,
  quotes: {},          // symbol -> { price, changePct1D }
  lastQuotesFetch: null,
  status: 'idle',
  error: null,
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.sectorCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    sectorState.quotes = parsed.quotes || sectorState.quotes;
    sectorState.lastQuotesFetch = parsed.lastQuotesFetch || null;
  } catch (_) {
    // ignore
  }
}

function saveCache() {
  const snapshot = {
    quotes: sectorState.quotes,
    lastQuotesFetch: sectorState.lastQuotesFetch,
  };
  localStorage.setItem(STORAGE_KEYS.sectorCache, JSON.stringify(snapshot));
}

loadCache();

function getSectorSymbols() {
  return sectorState.sectors.map((s) => s.symbol);
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
        `/quote?symbol=${encodeURIComponent(symbol)}`,
        { keyName: 'sectors' }
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

  saveCache();
}

export async function getSectorData() {
  try {
    await refreshSectorQuotesIfNeeded();
  } catch (err) {
    sectorState.error = err.message;
  }

  return {
    sectors: sectorState.sectors,
    quotes: sectorState.quotes,
    marketCaps: SECTOR_WEIGHTS,
    lastQuotesFetch: sectorState.lastQuotesFetch,
    status: sectorState.status,
    error: sectorState.error,
  };
}

export function resetSectorCache() {
  try {
    localStorage.removeItem(STORAGE_KEYS.sectorCache);
  } catch (_) {
    // ignore
  }

  sectorState = {
    sectors: SECTOR_LIST,
    quotes: {},
    lastQuotesFetch: null,
    status: 'idle',
    error: null,
  };
}
