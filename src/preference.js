// Persisting an explicit choice.
//
// It goes in a cookie, not only localStorage, because localStorage is invisible
// to the server. A server-rendered page would otherwise always use
// Accept-Language and then visibly correct itself once scripts run. The cookie
// is what lets the first paint already be right. localStorage is kept as a
// backstop for when cookies are refused.
import { canonicalizeTag } from './language-tag.js';
import { normalizeCountry } from './country.js';

const DEFAULTS = {
  cookieName: 'locale_pref',
  maxAge: 31536000, // one year
  storageKey: 'locale_pref'
};

// Read and write both validate. A hand-edited cookie is untrusted input, and it
// must not be able to reach a cache key or a file path downstream.
function sanitize(value) {
  const language = canonicalizeTag(value?.language);
  const country = normalizeCountry(value?.country);
  const city = typeof value?.city === 'string' && value.city.trim()
    ? value.city.trim().slice(0, 80)
    : null;
  return { language, country, city };
}

function parseCookieHeader(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const key = pair.slice(0, eq).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(pair.slice(eq + 1).trim());
    } catch {
      // A malformed percent-escape is not worth failing the whole request over.
    }
  }
  return out;
}

export { parseCookieHeader };

function decode(raw) {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const value = sanitize({
    language: params.get('lang'),
    country: params.get('country'),
    city: params.get('city')
  });
  return value.language || value.country ? value : null;
}

/** @returns {{language, country, city, source: 'cookie'|'localStorage'|null}} */
export function readPreference(options = {}) {
  const { cookieName, storageKey } = { ...DEFAULTS, ...options };
  const doc = options.document ?? globalThis.document;
  const store = options.localStorage ?? globalThis.localStorage;

  const fromCookie = decode(parseCookieHeader(doc?.cookie)[cookieName]);
  if (fromCookie) return { ...fromCookie, source: 'cookie' };

  try {
    const fromStorage = decode(store?.getItem(storageKey));
    if (fromStorage) return { ...fromStorage, source: 'localStorage' };
  } catch {
    // Storage access throws outright in some privacy modes.
  }
  return { language: null, country: null, city: null, source: null };
}

export function writePreference(value, options = {}) {
  const { cookieName, maxAge, storageKey } = { ...DEFAULTS, ...options };
  const doc = options.document ?? globalThis.document;
  const store = options.localStorage ?? globalThis.localStorage;
  const location = options.location ?? globalThis.location;

  const clean = sanitize(value);
  if (!clean.language && !clean.country) return null;

  const params = new URLSearchParams();
  if (clean.language) params.set('lang', clean.language);
  if (clean.country) params.set('country', clean.country);
  if (clean.city) params.set('city', clean.city);
  const encoded = params.toString();

  // Not HttpOnly: the page reads it too. SameSite=Lax so a shared link still
  // carries the preference, and Secure only over https, or local development
  // would silently fail to persist anything.
  const secure = options.secure ?? location?.protocol === 'https:';
  const attributes = [`${cookieName}=${encoded}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  if (doc) doc.cookie = attributes.join('; ');

  try {
    store?.setItem(storageKey, encoded);
  } catch {
    // Quota or a blocked store: the cookie is the one that matters.
  }
  return clean;
}

export function clearPreference(options = {}) {
  const { cookieName, storageKey } = { ...DEFAULTS, ...options };
  const doc = options.document ?? globalThis.document;
  const store = options.localStorage ?? globalThis.localStorage;
  if (doc) doc.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    store?.removeItem(storageKey);
  } catch {
    // Nothing to do; the cookie is already gone.
  }
}
