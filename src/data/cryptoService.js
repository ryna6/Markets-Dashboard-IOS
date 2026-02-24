// src/data/cryptoService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';

const CRYPTO_REFRESH_MINUTES = 5;

// Top 15 coins by market cap (CoinGecko IDs)
const DEFAULT_IDS = [
  'bitcoin',        // BTC
  'ethereum',       // ETH
  'binancecoin',    // BNB
  'solana',         // SOL
  'ripple',         // XRP
  'cardano',        // ADA
  'dogecoin',       // DOGE
  'tron',           // TRX
  'avalanche-2',    // AVAX
  'toncoin',        // TON
  'chainlink',      // LINK
  'polkadot',       // DOT
  'uniswap',        // UNI
  'litecoin',       // LTC
  'polygon',        // MATIC
];

let cryptoState = {
  items: [],           // [{ id, symbol, name, price, marketCap, changePct1D, changePct1W, changePct1M, logoUrl }]
  lastFetch: null,
  status: 'idle',
  error: null,
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.cryptoCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    cryptoState.items = parsed.items || [];
    cryptoState.lastFetch = parsed.lastFetch || null;
  } catch (_) {
    // ignore corrupt cache
  }
}

function saveCache() {
  const snap = {
    items: cryptoState.items,
    lastFetch: cryptoState.lastFetch,
  };
  localStorage.setItem(STORAGE_KEYS.cryptoCache, JSON.stringify(snap));
}

loadCache();

async function refreshCryptoIfNeeded() {
  if (
    cryptoState.lastFetch &&
    !isOlderThanMinutes(
      cryptoState.lastFetch,
      CRYPTO_REFRESH_MINUTES,
      'America/New_York'
    )
  ) {
    return;
  }

  cryptoState.status = 'loading';
  cryptoState.error = null;

  const idsStr = DEFAULT_IDS.join(',');

  try {
    const data = await apiClient.coingecko(
      `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
        idsStr
      )}&price_change_percentage=24h,7d,30d&per_page=${DEFAULT_IDS.length}&page=1`
    );

    cryptoState.items = data.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      marketCap: c.market_cap ?? null,
      // Prefer *_in_currency if present, otherwise fallback
      changePct1D:
        c.price_change_percentage_24h_in_currency ??
        c.price_change_percentage_24h ??
        null,
      changePct1W: c.price_change_percentage_7d_in_currency ?? null,
      changePct1M: c.price_change_percentage_30d_in_currency ?? null,
      logoUrl: c.image || null,
    }));

    cryptoState.lastFetch = toEstIso(new Date());
    cryptoState.status = 'ready';
    saveCache();
  } catch (err) {
    cryptoState.status = 'error';
    cryptoState.error = err.message;
  }
}

export async function getCryptoData() {
  try {
    await refreshCryptoIfNeeded();
  } catch (_) {
    // ignore, use last cache
  }
  return cryptoState;
}

export function resetCryptoCache() {
  try {
    localStorage.removeItem(STORAGE_KEYS.cryptoCache);
  } catch (_) {
    // ignore storage errors
  }

  cryptoState = {
    items: [],
    lastFetch: null,
    status: 'idle',
    error: null,
  };
}
