// src/components/sectorHeatmap.js
import { getSectorData, resetSectorCache } from '../data/sectorService.js';
import { resetSp500Cache } from '../data/stocksService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';
import { TIMEFRAMES, TIMEFRAME_STORAGE_KEYS } from '../data/constants.js';

export function initSectorHeatmap() {
  const view = document.getElementById('sectors-view');
  if (!view) {
    console.warn('Sector view container not found');
    return;
  }

  const heatmapEl = view.querySelector('.heatmap-container');
  const lastUpdatedEl = view.querySelector('.last-updated');
  const dropdown = view.querySelector('.timeframe-select');
  const refreshBtn = view.querySelector('.sectors-refresh-btn');

  if (!heatmapEl) {
    console.warn('Sector heatmap container not found');
    return;
  }

  const tfKey =
    (TIMEFRAME_STORAGE_KEYS && TIMEFRAME_STORAGE_KEYS.sectors) ||
    'md_sectors_timeframe';

  let currentTimeframe =
    localStorage.getItem(tfKey) || TIMEFRAMES.ONE_DAY;

  if (dropdown) {
    dropdown.value = currentTimeframe;
    dropdown.addEventListener('change', () => {
      currentTimeframe = dropdown.value;
      localStorage.setItem(tfKey, currentTimeframe);
      refresh();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Clear BOTH Sector and S&P caches
      resetSectorCache();
      resetSp500Cache();
      // Re-render this view immediately; S&P will refetch
      // next time you visit that tab or when its timer fires.
      refresh();
    });
  }

  async function refresh() {
    const tf = currentTimeframe;
    try {
      const {
        sectors,
        quotes,
        weeklyChange,
        marketCaps,
        lastQuotesFetch,
        error,
      } = await getSectorData(tf);

      const tiles = sectors.map((s) => {
        const symbol = s.symbol;
        const q = quotes[symbol] || {};
        const w = weeklyChange[symbol] || {};
        const cap =
          marketCaps &&
          typeof marketCaps[symbol] === 'number' &&
          marketCaps[symbol] > 0
            ? marketCaps[symbol]
            : 1;

        return {
          symbol,
          label: s.name,
          marketCap: cap,
          changePct1D: q.changePct1D,
          changePct1W: w.changePct1W,
        };
      });

      renderHeatmap(heatmapEl, tiles, tf);
      renderLastUpdatedLine(lastUpdatedEl, lastQuotesFetch, tf, error);
    } catch (err) {
      console.error('Sector refresh error', err);
      renderLastUpdatedLine(
        lastUpdatedEl,
        null,
        currentTimeframe,
        err.message
      );
    }
  }

  // Initial paint
  refresh();
  // Periodic refresh every 10 minutes
  setInterval(refresh, 10 * 60 * 1000);
}
