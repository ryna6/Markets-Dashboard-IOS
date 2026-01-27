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

  // ---- Toggle this to compare layouts quickly ----
  // true  -> use crypto-style constrained treemap for S&P
  // false -> use default row-fill treemap for S&P
  const USE_CONSTRAINED_SP500_LAYOUT = true;

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Clear BOTH S&P and Sector caches to keep them in sync
      resetSp500Cache();
      resetSectorCache();
      refresh();
    });
  }

  // Follow-up refresh: fills in caps/logos after quotes cached (reduces Finnhub 429)
  let followUpTimer = null;

  async function refresh() {
    const timeframe = '1D'; // S&P shows 1D
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
          logoUrl: logos ? (logos[sym.toUpperCase()] ?? logos[sym]) : null,
        };
      });

      // If caps are missing, schedule a short follow-up refresh so profile fetch
      // can happen after the quote burst settles.
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

      if (USE_CONSTRAINED_SP500_LAYOUT) {
        // Apply the crypto-style layout algorithm (strip flipping) to S&P:
        // - No forced top strip (that's crypto/BTC-specific)
        // - Make ALL symbols "priority" so the anti-thin-strip rule always applies
        const prioritySymbols = symbols.map((s) => String(s).toUpperCase());

        renderHeatmap(heatmapContainer, tiles, timeframe, {
          mode: 'crypto',
          prioritySymbols,
          // Starting point: S&P has many names; keep this slightly lower than crypto
          // so it doesn't over-flip and create overly chunky blocks.
          // If you still see thin strips -> increase (0.70 -> 0.76 -> 0.82)
          minPriorityTextScale: 0.70,
          // forceTopFullWidthSymbol: undefined (do NOT set)
        });
      } else {
        // Original S&P layout
        renderHeatmap(heatmapContainer, tiles, timeframe);
      }

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

  refresh();
  setInterval(refresh, 10 * 60 * 1000);
}
