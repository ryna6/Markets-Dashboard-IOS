// sw.js - basic PWA service worker for Market Dashboard

const CACHE_NAME = 'market-dashboard-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  // Styles
  '/src/styles/base.css',
  '/src/styles/layout.css',
  '/src/styles/heatmap.css',
  '/src/styles/calendar.css',
  '/src/styles/tabs.css',
  // Core scripts
  '/src/main.js',
  '/src/router.js',
  // Components
  '/src/components/cryptoHeatmap.js',
  '/src/components/earningsCalendar.js',
  '/src/components/heatmap.js',
  '/src/components/lastUpdated.js',
  '/src/components/sectorHeatmap.js',
  '/src/components/sp500Heatmap.js',
  '/src/components/tabs.js',
  // Data modules
  '/src/data/apiClient.js',
  '/src/data/companyService.js',
  '/src/data/constants.js',
  '/src/data/cryptoService.js',
  '/src/data/earningsService.js',
  '/src/data/importantTickers.js',
  '/src/data/sectorService.js',
  '/src/data/sp500-constituents.js',
  '/src/data/stocksService.js',
  '/src/data/timezone.js'
];

// Install: precache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// Fetch: cache-first strategy for GET requests
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).catch(() => {
        // Optional: you could return a fallback page/response here if desired.
      });
    })
  );
});
