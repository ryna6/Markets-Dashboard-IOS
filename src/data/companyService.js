// src/data/companyService.js
import { apiClient } from './apiClient.js';
import { STORAGE_KEYS } from './constants.js';
import { toEstIso, isOlderThanMinutes } from './timezone.js';

const PROFILE_REFRESH_MINUTES = 60 * 24 * 3; // ~3 days

let profileState = {
  profiles: {},      // symbol -> { name, marketCap, logo }
  fetchedAt: {}      // symbol -> ISO datetime
};

function loadCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.companyProfilesCache);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    profileState = { ...profileState, ...parsed };
  } catch (_) {}
}

function saveCache() {
  const snapshot = {
    profiles: profileState.profiles,
    fetchedAt: profileState.fetchedAt
  };
  localStorage.setItem(STORAGE_KEYS.companyProfilesCache, JSON.stringify(snapshot));
}

loadCache();

/**
 * Fetch company profile (name, marketCap, logo) from Finnhub stock/profile2
 * https://finnhub.io/docs/api/company-profile2 
 */
export async function getCompanyProfile(symbol) {
  const cached = profileState.profiles[symbol];
  const last = profileState.fetchedAt[symbol];

  if (
    cached &&
    last &&
    !isOlderThanMinutes(last, PROFILE_REFRESH_MINUTES, 'America/New_York')
  ) {
    return cached;
  }

  let data;
  try {
    data = await apiClient.finnhub(
      `/stock/profile2?symbol=${encodeURIComponent(symbol)}`
    );
  } catch (err) {
    // On error, return whatever cache we had, or a basic object
    return cached || { name: symbol, marketCap: null, logo: null };
  }

  const marketCap = data.marketCapitalization ?? null;
  let logo = data.logo || null;
  if (logo && !logo.startsWith('http')) {
    // Finnhub sometimes returns "static.finnhub.io/..." 
    logo = `https://${logo}`;
  }

  const profile = {
    name: data.name || symbol,
    marketCap,
    logo
  };

  profileState.profiles[symbol] = profile;
  profileState.fetchedAt[symbol] = toEstIso(new Date());
  saveCache();

  return profile;
}
