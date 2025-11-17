// src/data/constants.js

export const TIMEFRAMES = {
  ONE_DAY: '1D',
  ONE_WEEK: '1W',
};

export const STORAGE_KEYS = {
  // Legacy global timeframe (not used by new code)
  timeframe: 'md_timeframe',

  // S&P 500 caches
  sp500Cache: 'md_sp500_cache',      // quotes, weeklyChange, marketCaps
  sp500History: 'md_sp500_history',  // daily close history + lastWeeklyCalc

  // Sector caches
  sectorCache: 'md_sector_cache',      // quotes, weeklyChange
  sectorHistory: 'md_sector_history',  // daily close history + lastWeeklyCalc

  // Crypto + earnings + profiles
  cryptoCache: 'md_crypto_cache',
  earningsCache: 'md_earnings_cache',
  companyProfilesCache: 'companyProfilesCache',
};

export const TIMEFRAME_STORAGE_KEYS = {
  sp500: 'md_sp500_timeframe',
  sectors: 'md_sectors_timeframe',
  crypto: 'md_crypto_timeframe',
};
