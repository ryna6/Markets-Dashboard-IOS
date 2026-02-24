// src/data/constants.js

export const TIMEFRAMES = {
  ONE_DAY: '1D',
  ONE_WEEK: '1W',
  ONE_MONTH: '1M',
};

export const STORAGE_KEYS = {
  // S&P 500 cache
  sp500Cache: 'md_sp500_cache',

  // Sector cache
  sectorCache: 'md_sector_cache',

  // Crypto + earnings + profiles
  cryptoCache: 'md_crypto_cache',
  earningsCache: 'md_earnings_cache',
  companyProfilesCache: 'companyProfilesCache',
};

export const TIMEFRAME_STORAGE_KEYS = {
  // Only crypto still supports 1D/1W switching
  crypto: 'md_crypto_timeframe',
};
