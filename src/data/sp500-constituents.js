// src/data/sp500-constituents.js

// NOTE: This is a partial sample list, not the full 500.
// You can expand this list or regenerate from FMP's /sp500_constituent
// endpoint and paste it here if you want offline/fallback behavior.

export const SP500_CONSTITUENTS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)' },
  { symbol: 'GOOG', name: 'Alphabet Inc. (Class C)' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. (Class B)' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'UNH', name: 'UnitedHealth Group Incorporated' },
  { symbol: 'HD', name: 'The Home Depot Inc.' },
  { symbol: 'PG', name: 'The Procter & Gamble Company' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation' },
  { symbol: 'MA', name: 'Mastercard Incorporated' },
  { symbol: 'LLY', name: 'Eli Lilly and Company' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'KO', name: 'The Coca-Cola Company' }
  // ...add more as needed
];

export const SP500_SYMBOLS = SP500_CONSTITUENTS.map(c => c.symbol);
