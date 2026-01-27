// src/data/companyService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';

const PROFILE_TTL_MINUTES = 60 * 24 * 7; // cache 1 week

let profileCache = {}; // symbol -> { symbol, name, logo, marketCap, lastFetchIso }

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.companyProfilesCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    profileCache = parsed || {};
  } catch (_) {}
}

function saveCache() {
  localStorage.setItem(
    STORAGE_KEYS.companyProfilesCache,
    JSON.stringify(profileCache)
  );
}

loadCache();

function isStale(lastFetchIso) {
  if (!lastFetchIso) return true;
  const last = new Date(lastFetchIso);
  const now = new Date();
  const diffMs = now - last;
  return diffMs > PROFILE_TTL_MINUTES * 60 * 1000;
}

export async function getCompanyProfile(symbol) {
  const key = symbol.toUpperCase();
  const cached = profileCache[key];
  if (cached && !isStale(cached.lastFetchIso)) {
    return cached;
  }

  const data = await apiClient.finnhub(
    `/stock/profile2?symbol=${encodeURIComponent(key)}`,
    { keyName: 'companies' }
  );

  // Finnhub field: marketCapitalization (number; units may be billions)
  const rawCap =
    typeof data.marketCapitalization === 'number'
      ? data.marketCapitalization
      : null;

  let logoUrl = null;
  if (data.logo) {
    logoUrl = data.logo.startsWith('http')
      ? data.logo
      : `https://${data.logo}`;
  }

  const profile = {
    symbol: key,
    name: data.name || data.ticker || key,
    logo: logoUrl,
    marketCap: rawCap,
    lastFetchIso: new Date().toISOString(),
  };

  profileCache[key] = profile;
  saveCache();
  return profile;
}
