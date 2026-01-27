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

  // One-time short retry used to fill in market caps/logos after quotes
  // are cached (helps avoid Finnhub rate limiting on initial open).
  let followUpTimer = null;

  async function refresh() {
    const timeframe = '1D'; // S&P only shows 1D now
    try {
      const data = await getSp500Data();
      const { symbols, quotes, marketCaps, logos } = data;

      const tiles = symbols.map((sym) => {
        const q = quotes[sym] || {};
        return {
          symbol: sym,
          marketCap: marketCaps
            ? (marketCaps[sym.toUpperCase()] ?? marketCaps[sym])
            : null,
          changePct1D: q.changePct1D,
          // 1W unused here; heatmap uses 1D because timeframe='1D'
          logoUrl: logos ? logos[sym.toUpperCase()] || logos[sym] : null,
        };
      });

      // If market caps are still missing for some symbols, schedule a short
      // follow-up refresh (about 1 minute) so profile fetches can happen
      // after the quote burst has settled (avoids hitting rate limits).
      const missingCaps = symbols.filter((sym) => {
        const key = sym.toUpperCase();
        const cap = marketCaps ? (marketCaps[key] ?? marketCaps[sym]) : null;
        return !(typeof cap === 'number' && cap > 0);
      }).length;

      if (missingCaps > 0 && !followUpTimer) {
        followUpTimer = setTimeout(() => {
          followUpTimer = null;
          refresh();
        }, 70 * 1000);
      }

      renderHeatmap(heatmapContainer, tiles, timeframe);
      renderLastUpdatedLine(
        lastUpdatedEl,
        data.lastQuotesFetch,
        timeframe,
        data.error
      );
    } catch (err) {
      renderLastUpdatedLine(lastUpdatedEl, null, '1D', err.message);
    }
  }

  // Initial render
  refresh();

  // Auto-refresh every 10 minutes
  setInterval(refresh, 10 * 60 * 1000);
}
