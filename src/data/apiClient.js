// src/data/apiClient.js
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CG_BASE = 'https://api.coingecko.com/api/v3';
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

const FINNHUB_KEY = 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0';
const CG_KEY = 'CG-3Vngf8kaoQdxDXjrg1jUJyYB';
const FMP_KEY = 'Gl0UqnbzAqPsM5uBqBMISCn3kDw9If4w';

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

export const apiClient = {
  // Finnhub for sector heatmap and earnings calendar
  async finnhub(pathAndQuery) {
    const joiner = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${FINNHUB_BASE}${pathAndQuery}${joiner}token=${encodeURIComponent(FINNHUB_KEY)}`;
    return fetchJson(url);
  },

  // CoinGecko stays as-is for crypto
  async coingecko(pathAndQuery) {
    const url = `${CG_BASE}${pathAndQuery}`;
    const headers = CG_KEY
      ? { 'x-cg-demo-api-key': CG_KEY }
      : {};
    return fetchJson(url, { headers });
  }

  // FMP for S&P500 heatmap
  fmp(pathAndQuery) {
    const joiner = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${FMP_BASE}${pathAndQuery}${joiner}apikey=${encodeURIComponent(
      FMP_KEY
    )}`;
    return fetchJson(url);
  },
};
