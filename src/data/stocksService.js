// src/data/stocksService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';
import { SP500_SYMBOLS } from './sp500-constituents.js';
import { getCompanyProfile } from './companyService.js';

const SP500_REFRESH_MINUTES = 10;                 // quotes refresh cadence
const SP500_MARKETCAP_TTL_MINUTES = 60 * 24 * 7; // 1 week for market caps

// Clean up old history key from previous versions (if present)
try {
  localStorage.removeItem('md_sp500_history');
} catch (_) {
  // ignore
}

let sp500State = {
  symbols: SP500_SYMBOLS.slice(), // S&P universe (or your subset)
  quotes: {},                     // symbol -> { price, changePct1D }
  marketCaps: {},                 // symbol -> number
  lastQuotesFetch: null,
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
    sp500State.marketCaps = parsed.marketCaps || {};
    sp500State.lastQuotesFetch = parsed.lastQuotesFetch || null;
    sp500State.lastMarketCapFetch = parsed.lastMarketCapFetch || null;
  } catch (_) {
    // ignore
  }
}

function saveCache() {
  const snapshot = {
    symbols: sp500State.symbols,
    quotes: sp500State.quotes,
    marketCaps: sp500State.marketCaps,
    lastQuotesFetch: sp500State.lastQuotesFetch,
    lastMarketCapFetch: sp500State.lastMarketCapFetch,
  };
  localStorage.setItem(STORAGE_KEYS.sp500Cache, JSON.stringify(snapshot));
}

loadCache();

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

  saveCache();
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

  if (profile && typeof profile.marketCap ==='number') {
    marketCaps[symbol] = profile.marketCap;
  }
  const logo = profile.logo || null;
  if (!sp500State.logos) sp500State.logos = {};
  sp500State.logos[symbol] = logo;
  
  sp500State.marketCaps = marketCaps;
  sp500State.lastMarketCapFetch = nowEstIso;
  saveCache();
}

// ----------------- Public API used by sp500Heatmap -----------------------

export async function getSp500Data() {
  try {
    await refreshQuotesIfNeeded();
  } catch (_) {
    // keep last cache
  }

  try {
    await refreshMarketCapsIfNeeded();
  } catch (_) {}

  return {
    symbols: sp500State.symbols,
    quotes: sp500State.quotes,
    marketCaps: sp500State.marketCaps,
    logos: sp500State.logos,
    lastQuotesFetch: sp500State.lastQuotesFetch,
    status: sp500State.status,
    error: sp500State.error,
  };
}

export function resetSp500Cache() {
  try {
    localStorage.removeItem(STORAGE_KEYS.sp500Cache);
  } catch (_) {
    // ignore
  }

  sp500State = {
    symbols: SP500_SYMBOLS.slice(),
    quotes: {},
    marketCaps: {},
    lastQuotesFetch: null,
    lastMarketCapFetch: null,
    status: 'idle',
    error: null,
  };
}
