// src/components/sp500Heatmap.js
import { getSp500Data, resetSp500Cache } from '../data/stocksService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';

export function initSp500Heatmap() {
  const view = document.getElementById('sp500-view');
  if (!view) return;

  const heatmapEl = view.querySelector('.heatmap-container');
  const lastUpdatedEl = view.querySelector('.last-updated');
  const refreshBtn = view.querySelector('.sp500-refresh-btn');
  if (!heatmapEl) return;

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      resetSp500Cache();
      refresh();
    });
  }

  async function refresh() {
    const timeframe = '1D';
    try {
      const data = await getSp500Data();
      const { symbols, quotes, marketCaps, logos } = data;

      const tiles = symbols.map((sym) => {
        const key = String(sym || '').toUpperCase();
        const q = quotes?.[key] || quotes?.[sym] || {};
        const cap = marketCaps?.[key] ?? marketCaps?.[sym] ?? null;

        return {
          symbol: key,
          marketCap: typeof cap === 'number' && cap > 0 ? cap : 1,
          changePct1D: q.changePct1D,
          logoUrl: logos?.[key] ?? logos?.[sym] ?? null,
        };
      });

      // IMPORTANT: no mode passed => uses row-only layout (top->bottom, left->right)
      renderHeatmap(heatmapEl, tiles, timeframe);

      renderLastUpdatedLine(lastUpdatedEl, data.lastQuotesFetch, timeframe, data.error);
    } catch (err) {
      renderLastUpdatedLine(lastUpdatedEl, null, '1D', err?.message || String(err));
    }
  }

  refresh();
  setInterval(refresh, 10 * 60 * 1000);
}
