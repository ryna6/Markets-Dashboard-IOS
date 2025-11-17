// src/components/sp500Heatmap.js
import { getSp500Data, resetSp500Cache } from '../data/stocksService.js';
import { resetSectorCache } from '../data/sectorService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';

export function initSp500Heatmap() {
  const container = document.getElementById('sp500-view');
  if (!container) return;

  const heatmapContainer = container.querySelector('.heatmap-container');
  const lastUpdatedEl = container.querySelector('.last-updated');
  const refreshBtn = container.querySelector('.sp500-refresh-btn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Clear BOTH S&P and Sector caches to keep them in sync
      resetSp500Cache();
      resetSectorCache();
      refresh();
    });
  }

  async function refresh() {
    const timeframe = '1D'; // S&P only shows 1D now
    try {
      const data = await getSp500Data();
      const { symbols, quotes, marketCaps } = data;

      const tiles = symbols.map((sym) => {
        const q = quotes[sym] || {};
        return {
          symbol: sym,
          marketCap: marketCaps ? marketCaps[sym] : null,
          changePct1D: q.changePct1D,
          // changePct1W is unused for S&P; heatmap will use 1D because timeframe='1D'
        };
      });

      renderHeatmap(heatmapContainer, tiles, timeframe);
      renderLastUpdatedLine(
        lastUpdatedEl,
        data.lastQuotesFetch,
        timeframe,
        data.error
      );
    } catch (err) {
      renderLastUpdatedLine(
        lastUpdatedEl,
        null,
        '1D',
        err.message
      );
    }
  }

  // Initial render
  refresh();

  // Auto-refresh every 10 minutes
  setInterval(refresh, 10 * 60 * 1000);
}
