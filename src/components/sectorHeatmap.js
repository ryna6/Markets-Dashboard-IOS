// src/components/sectorHeatmap.js
import { getSectorData } from '../data/sectorService.js';
import { renderHeatmap } from './heatmap.js';
import { renderLastUpdatedLine } from './lastUpdated.js';
import { getTimeframe, setTimeframe } from '../main.js';

export function initSectorHeatmap() {
  const view = document.getElementById('sectors-view');
  if (!view) {
    console.warn('Sector view container not found');
    return;
  }

  const heatmapEl = view.querySelector('.heatmap-container');
  const lastUpdatedEl = view.querySelector('.last-updated');
  const dropdown = view.querySelector('.timeframe-select');

  if (!heatmapEl) {
    console.warn('Sector heatmap container not found');
    return;
  }

  if (dropdown) {
    dropdown.value = getTimeframe();
    dropdown.addEventListener('change', () => {
      const tf = dropdown.value;
      setTimeframe(tf);
    });
  }

  async function refresh() {
    const tf = getTimeframe();
    try {
      const {
        sectors,
        quotes,
        weeklyChange,
        marketCaps,
        lastQuotesFetch,
        error,
      } = await getSectorData(tf);

      // Build tiles and ALWAYS supply a numeric marketCap (fallback = 1)
      const tiles = sectors.map((s) => {
        const symbol = s.symbol;
        const q = quotes[symbol] || {};
        const w = weeklyChange[symbol] || {};

        const cap =
          marketCaps &&
          typeof marketCaps[symbol] === 'number' &&
          marketCaps[symbol] > 0
            ? marketCaps[symbol]
            : 1; // fallback so treemap still renders tiles

        return {
          symbol,
          label: s.name,
          marketCap: cap,
          changePct1D: q.changePct1D,
          changePct1W: w.changePct1W,
        };
      });

      // Debug if needed
      // console.log('Sector tiles', tiles);

      renderHeatmap(heatmapEl, tiles, tf);
      renderLastUpdatedLine(lastUpdatedEl, lastQuotesFetch, tf, error);
    } catch (err) {
      console.error('Sector refresh error', err);
      renderLastUpdatedLine(lastUpdatedEl, null, getTimeframe(), err.message);
    }
  }

  // Initial paint
  refresh();
  // Periodic refresh every 10 minutes
  setInterval(refresh, 10 * 60 * 1000);

  // React to timeframe dropdown changes from other tabs
  window.addEventListener('timeframe-changed', () => {
    refresh();
  });
}
