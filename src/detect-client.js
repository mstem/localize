// Detection in the browser.
//
// Every ambient global is a parameter with a default. That is what makes this
// testable without a browser: pass a literal for navigator and a stub for Intl
// and the whole thing runs under node:test, no jsdom, no Playwright.
import { parseLanguageTag, canonicalizeTag } from './language-tag.js';
import { dirForLanguage } from './direction.js';
import { countryFromTimeZone, cityFromTimeZone } from './timezone.js';
import { normalizeCountry } from './country.js';
import { readPreference } from './preference.js';

function reportedTimeZone(intl) {
  try {
    return intl?.DateTimeFormat?.().resolvedOptions?.().timeZone ?? null;
  } catch {
    // Some environments throw here rather than returning undefined.
    return null;
  }
}

function reportedLanguages(navigator) {
  const list = Array.isArray(navigator?.languages) ? navigator.languages : [];
  const single = typeof navigator?.language === 'string' ? [navigator.language] : [];
  return [...list, ...single];
}

/**
 * @returns {{language, country, timezone, city, override}} Each of language,
 *   country and city carries its own source and confidence, so a caller can
 *   tell a solid answer from a guess instead of receiving a bare string.
 */
export function detectClient(options = {}) {
  const navigator = options.navigator ?? globalThis.navigator;
  const intl = options.intl ?? globalThis.Intl;
  const fallback = options.fallback ?? 'en';

  const stated = readPreference(options);

  // Language: an explicit choice, else the first well-formed tag the browser
  // reports. navigator.languages is ordered by preference; navigator.language
  // is the single-value fallback for anything that lacks the list.
  let language = null;
  if (stated.language) {
    language = { ...parseLanguageTag(stated.language), source: 'override', confidence: 'high' };
  } else {
    for (const candidate of reportedLanguages(navigator)) {
      const parsed = parseLanguageTag(candidate);
      if (parsed) {
        language = {
          ...parsed,
          source: Array.isArray(navigator?.languages) && navigator.languages.includes(candidate)
            ? 'navigator.languages'
            : 'navigator.language',
          confidence: 'high'
        };
        break;
      }
    }
  }
  if (!language) {
    language = { ...parseLanguageTag(canonicalizeTag(fallback) ?? 'en'), source: 'fallback', confidence: 'low' };
  }
  language.dir = dirForLanguage(language.tag);
  delete language.variants;

  const reported = reportedTimeZone(intl);
  const zone = countryFromTimeZone(reported);
  const regionCountry = normalizeCountry(language.region);

  // Two independent signals, so they can corroborate each other. Agreement is
  // the only thing that earns high confidence; disagreement means one of them
  // is wrong and there is no way to tell which, so the time zone wins on the
  // grounds that it reflects where the machine is rather than how it is
  // configured to read, and the caller is told to let the visitor decide.
  let country;
  if (stated.country) {
    country = { code: stated.country, source: 'override', confidence: 'high', agreesWithLanguageRegion: null };
  } else if (zone.country) {
    const agrees = regionCountry ? regionCountry === zone.country : null;
    const confidence = agrees === true ? 'high' : agrees === false ? 'low' : 'medium';
    country = { code: zone.country, source: 'timezone', confidence, agreesWithLanguageRegion: agrees };
  } else if (regionCountry) {
    country = { code: regionCountry, source: 'language-region', confidence: 'low', agreesWithLanguageRegion: true };
  } else {
    country = { code: null, source: null, confidence: 'none', agreesWithLanguageRegion: null };
  }

  const representative = cityFromTimeZone(reported);
  const city = stated.city
    ? { name: stated.city, kind: 'stated', confidence: 'high' }
    : representative
      ? { ...representative, confidence: 'low' }
      : null;

  return {
    language,
    country,
    city,
    // Only a zone that actually resolved is reported. Echoing back an
    // unrecognised string here would look like a real answer to a caller that
    // forwards it on.
    timezone: zone.country
      ? { reported, canonical: zone.canonicalZone ?? reported }
      : null,
    override: { language: Boolean(stated.language), country: Boolean(stated.country) }
  };
}
