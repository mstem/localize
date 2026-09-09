// The set of country codes the zone table knows, reused as the validator for
// anything claiming to be a country: a geo header, a query parameter, a cookie.
// Deriving it from data already shipped avoids carrying iso3166.tab as well.
//
// It covers 247 of the 249 assigned ISO 3166-1 codes. The two absent are BV and
// HM, both uninhabited, so nothing will ever be detected in them.
import { PACKED_ZONE_COUNTRY } from '../data/zone-country.js';

let codes = null;

export function countryCodes() {
  if (!codes) {
    codes = new Set(PACKED_ZONE_COUNTRY.split(';').map((group) => group.slice(0, group.indexOf(':'))));
  }
  return codes;
}

/** Normalises case and validates. Returns the code, or null. */
export function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  return countryCodes().has(upper) ? upper : null;
}
