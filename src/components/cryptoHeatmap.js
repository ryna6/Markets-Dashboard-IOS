// src/components/cryptoHeatmap.js
import { getCryptoData, resetCryptoCache } from '../data/cryptoService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';
import { TIMEFRAMES, TIMEFRAME_STORAGE_KEYS } from '../data/constants.js';

export function initCryptoHeatmap() {
  const container = document.getElementById('crypto-view');
  if (!container) return;

  const heatmapContainer = container.querySelector('.heatmap-container');
  const lastUpdatedEl = container.querySelector('.last-updated');
  const dropdown = container.querySelector('.timeframe-select');
  const refreshBtn = container.querySelector('.crypto-refresh-btn');

  const tfKey = TIMEFRAME_STORAGE_KEYS.crypto;
  const savedTf =
    (tfKey && localStorage.getItem(tfKey)) || TIMEFRAMES.ONE_DAY;

  let currentTimeframe =
    savedTf === TIMEFRAMES.ONE_WEEK ? TIMEFRAMES.ONE_WEEK : TIMEFRAMES.ONE_DAY;

  if (dropdown) {
    dropdown.value = currentTimeframe;
    dropdown.addEventListener('change', () => {
      const value =
        dropdown.value === TIMEFRAMES.ONE_WEEK
          ? TIMEFRAMES.ONE_WEEK
          : TIMEFRAMES.ONE_DAY;

      currentTimeframe = value;
      if (tfKey) localStorage.setItem(tfKey, value);
      refresh();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      resetCryptoCache();
      refresh();
    });
  }

  // Priority coins: these should not get shoved into a tiny strip where text is cramped.
  // Smaller coins can fall back to logo-only.
  const CRYPTO_PRIORITY = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'TRX', 'DOGE', 'ADA'];

  async function refresh() {
    const tf = currentTimeframe;

    try {
      const data = await getCryptoData();
      const { items, lastFetch, error } = data;

      const tiles = items.map((c) => ({
        symbol: c.symbol,
        label: c.name,
        marketCap: c.marketCap,
        changePct1D: c.changePct1D,
        changePct1W: c.changePct1W,
        logoUrl: c.logoUrl || null,
      }));

      renderHeatmap(heatmapContainer, tiles, tf, {
        mode: 'crypto',
        forceTopFullWidthSymbol: 'BTC',
        prioritySymbols: CRYPTO_PRIORITY,
        // This is the legibility threshold (measuredContent * scale).
        // Higher = stronger protection from thin strips.
        minPriorityTextScale: 1.0,
      });

      renderLastUpdatedLine(lastUpdatedEl, lastFetch, tf, error);
    } catch (err) {
      renderLastUpdatedLine(lastUpdatedEl, null, currentTimeframe, err.message);
    }
  }

  refresh();
  setInterval(refresh, 5 * 60 * 1000);
}
