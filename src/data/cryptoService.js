// data/cryptoService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';

const CRYPTO_REFRESH_MINUTES = 5;
const DEFAULT_IDS = [
  'bitcoin',
  'ethereum',
  'solana',
  'binancecoin',
  'ripple',
  'cardano',
  'dogecoin'
];

let cryptoState = {
  items: [],       // [{ id, symbol, name, price, marketCap, changePct1D, changePct1W }]
  lastFetch: null,
  status: 'idle',
  error: null
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.cryptoCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    cryptoState = { ...cryptoState, ...parsed };
  } catch (_) {}
}

function saveCache() {
  const snap = {
    items: cryptoState.items,
    lastFetch: cryptoState.lastFetch
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
      )}&price_change_percentage=24h,7d&per_page=${DEFAULT_IDS.length}&page=1`
    );

    cryptoState.items = data.map(c => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      marketCap: c.market_cap ?? null,
      changePct1D: c.price_change_percentage_24h,
      changePct1W: c.price_change_percentage_7d_in_currency
    }));

    cryptoState.lastFetch = toEstIso(new Date());
    cryptoState.status = 'ready';
    saveCache();
  } catch (err) {
    cryptoState.status = 'error';
    cryptoState.error = err.message;
    throw err;
  }
}

export async function getCryptoData() {
  try {
    await refreshCryptoIfNeeded();
  } catch (_) {}
  return cryptoState;
}
