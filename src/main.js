// main.js
import { initTabs } from './components/tabs.js';
import { initSp500Heatmap } from './components/sp500Heatmap.js';
import { initSectorHeatmap } from './components/sectorHeatmap.js';
import { initCryptoHeatmap } from './components/cryptoHeatmap.js';
import { initEarningsCalendar } from './components/earningsCalendar.js';

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSp500Heatmap();

  // Lazy-init non-default tabs so we don't hammer Finnhub on first load.
  // This also reduces the chance of rate limiting preventing the S&P heatmap
  // from having all market caps/logos on initial open.
  let sectorsInited = false;
  let cryptoInited = false;
  let earningsInited = false;

  const tabs = document.querySelectorAll('#tab-bar .tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tab;
      if (name === 'sectors' && !sectorsInited) {
        initSectorHeatmap();
        sectorsInited = true;
      }
      if (name === 'crypto' && !cryptoInited) {
        initCryptoHeatmap();
        cryptoInited = true;
      }
      if (name === 'earnings' && !earningsInited) {
        initEarningsCalendar();
        earningsInited = true;
      }
    });
  });

  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => {
          console.error('Service worker registration failed:', err);
        });
    });
  }
});
