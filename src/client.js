// Browser entry point. Also re-exports the pure helpers, so a page needs one
// import rather than two.
export { detectClient } from './detect-client.js';
export { readPreference, writePreference, clearPreference } from './preference.js';
export { parseLanguageTag, canonicalizeTag, bundleKey } from './language-tag.js';
export { dirForLanguage } from './direction.js';
export { countryFromTimeZone, cityFromTimeZone, canonicalizeTimeZone } from './timezone.js';
export { normalizeCountry } from './country.js';
