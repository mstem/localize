// Detection from an HTTP request. Framework-agnostic on purpose: it takes plain
// objects, so req.headers and req.query drop straight in, and it works the same
// under Express, a bare http server, or a test with a literal.
import { negotiateLanguage } from './accept-language.js';
import { canonicalizeTag, parseLanguageTag } from './language-tag.js';
import { dirForLanguage } from './direction.js';
import { normalizeCountry } from './country.js';
import { parseCookieHeader } from './preference.js';

// Edge networks that put the visitor's country in a request header. Checked in
// order; the first that holds a code this build recognises wins. Never trusted
// raw, because a client can send any header it likes when no proxy overwrites
// it.
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'fly-client-ip-country', 'x-country-code'];
const GEO_CITY_HEADERS = ['cf-ipcity', 'x-vercel-ip-city'];

const header = (headers, name) => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * @param {{headers?: object, cookies?: object, query?: object}} request
 * @param {{fallback?: string, available?: string[]|null, cookieName?: string}} [options]
 */
export function detectFromRequest(request = {}, options = {}) {
  const { fallback = 'en', available = null, cookieName = 'locale_pref' } = options;
  const headers = request.headers ?? {};
  const query = request.query ?? {};
  // Express has no req.cookies without cookie-parser, so the header is parsed
  // here rather than assuming middleware is installed.
  const cookies = request.cookies ?? parseCookieHeader(header(headers, 'cookie'));

  const cookieValues = new URLSearchParams(cookies[cookieName] ?? '');
  const acceptLanguage = header(headers, 'accept-language') ?? null;

  const queryLanguage = canonicalizeTag(query.lang ?? query.language);
  const cookieLanguage = canonicalizeTag(cookieValues.get('lang'));

  let language;
  if (queryLanguage) {
    language = { ...parseLanguageTag(queryLanguage), source: 'query', confidence: 'high' };
  } else if (cookieLanguage) {
    language = { ...parseLanguageTag(cookieLanguage), source: 'cookie', confidence: 'high' };
  } else {
    const negotiated = negotiateLanguage(acceptLanguage, { available, fallback });
    language = {
      tag: negotiated.tag,
      language: negotiated.language,
      script: negotiated.script,
      region: negotiated.region,
      source: negotiated.source,
      confidence: negotiated.confidence
    };
  }
  language.dir = dirForLanguage(language.tag);
  delete language.variants;

  const geoHeaderName = GEO_HEADERS.find((name) => normalizeCountry(header(headers, name)));
  const queryCountry = normalizeCountry(query.country);
  const cookieCountry = normalizeCountry(cookieValues.get('country'));
  const geoCountry = geoHeaderName ? normalizeCountry(header(headers, geoHeaderName)) : null;
  // A region subtag is the weakest of the four: en-GB says the interface should
  // be British English, not that the visitor is in Britain.
  const regionCountry = normalizeCountry(language.region);

  let country;
  if (queryCountry) country = { code: queryCountry, source: 'query', confidence: 'high' };
  else if (cookieCountry) country = { code: cookieCountry, source: 'cookie', confidence: 'high' };
  else if (geoCountry) country = { code: geoCountry, source: 'geo-header', confidence: 'high' };
  else if (regionCountry) country = { code: regionCountry, source: 'language-region', confidence: 'low' };
  else country = { code: null, source: null, confidence: 'none' };

  const geoCityHeader = GEO_CITY_HEADERS.map((name) => header(headers, name)).find(Boolean);
  const cookieCity = cookieValues.get('city');
  const city = cookieCity
    ? { name: cookieCity.slice(0, 80), kind: 'stated', confidence: 'high' }
    : geoCityHeader
      ? { name: String(geoCityHeader).slice(0, 80), kind: 'ip-geolocation', confidence: 'low' }
      : null;

  return {
    language,
    country,
    city,
    // The server cannot see a time zone; only the client can report one.
    timezone: null,
    override: { language: Boolean(queryLanguage || cookieLanguage), country: Boolean(queryCountry || cookieCountry) },
    signals: {
      acceptLanguage,
      geoHeader: geoHeaderName ? { name: geoHeaderName, value: geoCountry } : null,
      cookieLanguage,
      cookieCountry
    }
  };
}
