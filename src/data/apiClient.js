// src/data/apiClient.js
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CG_BASE = 'https://api.coingecko.com/api/v3';

const FINNHUB_KEYS = {
  // Used when no keyName is provided
  default: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',

  sp500: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',
  sectors: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag',
};

const CG_KEY = 'CG-3Vngf8kaoQdxDXjrg1jUJyYB';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 429) {
    throw new Error('rate-limit');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function pickFinnhubToken(keyName) {
  if (keyName && FINNHUB_KEYS[keyName]) return FINNHUB_KEYS[keyName];
  return FINNHUB_KEYS.default;
}

export const apiClient = {
  /**
   * Finnhub generic caller
   * @param {string} pathAndQuery e.g. "/quote?symbol=AAPL"
   * @param {object} opts e.g. { keyName: "sp500" }
   */
  async finnhub(pathAndQuery, opts = {}) {
    const token = pickFinnhubToken(opts.keyName);
    if (!token) throw new Error('Missing Finnhub token');

    const joiner = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${FINNHUB_BASE}${pathAndQuery}${joiner}token=${encodeURIComponent(
      token
    )}`;
    return fetchJson(url);
  },

  // CoinGecko stays as-is for crypto
  async coingecko(pathAndQuery) {
    const url = `${CG_BASE}${pathAndQuery}`;
    const headers = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};
    return fetchJson(url, { headers });
  },
};
