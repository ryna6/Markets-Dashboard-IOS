// src/components/sectorHeatmap.js
import { getSectorData, resetSectorCache } from '../data/sectorService.js';
import { resetSp500Cache } from '../data/stocksService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';

export function initSectorHeatmap() {
  const view = document.getElementById('sectors-view');
  if (!view) {
    console.warn('Sector view container not found');
    return;
  }

  const heatmapEl = view.querySelector('.heatmap-container');
  const lastUpdatedEl = view.querySelector('.last-updated');
  const refreshBtn = view.querySelector('.sectors-refresh-btn');

  if (!heatmapEl) {
    console.warn('Sector heatmap container not found');
    return;
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      resetSectorCache();
      resetSp500Cache();
      refresh();
    });
  }

  async function refresh() {
    const timeframe = '1D';
    try {
      const { sectors, quotes, marketCaps, lastQuotesFetch, error } =
        await getSectorData();

      const tiles = sectors.map((s) => {
        const symbol = s.symbol;
        const q = quotes[symbol] || {};
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
        };
      });

      // All sectors should remain readable -> constrain all strips
      const sectorSymbols = sectors.map((s) => s.symbol);

      renderHeatmap(heatmapEl, tiles, timeframe, {
        mode: 'sectors',
        prioritySymbols: sectorSymbols,
        // If you still see super-short tiles, increase this (e.g. 0.78 → 0.84)
        minPriorityTextScale: 0.78,
      });

      renderLastUpdatedLine(lastUpdatedEl, lastQuotesFetch, timeframe, error);
    } catch (err) {
      console.error('Sector refresh error', err);
      renderLastUpdatedLine(lastUpdatedEl, null, '1D', err.message);
    }
  }

  refresh();
  setInterval(refresh, 10 * 60 * 1000);
}
