import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFromRequest } from '../src/detect-server.js';

test('Accept-Language decides the language when nothing else is stated', () => {
  const result = detectFromRequest({ headers: { 'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
  assert.equal(result.language.tag, 'pt-PT');
  assert.equal(result.language.source, 'accept-language');
  assert.equal(result.language.dir, 'ltr');
  // A region subtag is about how to read, not where the reader is, so it is the
  // weakest country signal rather than a confident one.
  assert.equal(result.country.code, 'PT');
  assert.equal(result.country.source, 'language-region');
  assert.equal(result.country.confidence, 'low');
});

test('the query string outranks the cookie, which outranks the header', () => {
  const headers = { 'accept-language': 'en-GB', cookie: 'locale_pref=lang%3Dfr%26country%3DFR' };
  const withQuery = detectFromRequest({ headers, query: { lang: 'ar', country: 'MA' } });
  assert.equal(withQuery.language.tag, 'ar');
  assert.equal(withQuery.language.source, 'query');
  assert.equal(withQuery.country.code, 'MA');
  assert.deepEqual(withQuery.override, { language: true, country: true });

  const withCookie = detectFromRequest({ headers });
  assert.equal(withCookie.language.tag, 'fr');
  assert.equal(withCookie.language.source, 'cookie');
  assert.equal(withCookie.country.code, 'FR');
});

test('the cookie header is parsed without cookie-parser middleware', () => {
  // Express has no req.cookies unless middleware is installed, and this package
  // must not require any.
  const result = detectFromRequest({
    headers: { cookie: 'session=abc; locale_pref=lang%3Dde-DE%26country%3DDE; other=1' }
  });
  assert.equal(result.language.tag, 'de-DE');
  assert.equal(result.country.code, 'DE');
});

test('an edge geo header is used and normalised', () => {
  for (const name of ['cf-ipcountry', 'x-vercel-ip-country', 'fly-client-ip-country', 'x-country-code']) {
    const result = detectFromRequest({ headers: { 'accept-language': 'en', [name]: 'pt' } });
    assert.equal(result.country.code, 'PT', `${name} should be read`);
    assert.equal(result.country.source, 'geo-header');
    assert.equal(result.country.confidence, 'high');
    assert.equal(result.signals.geoHeader.name, name);
  }
});

test('a geo header carrying a code this build does not know is ignored', () => {
  // The header is only trustworthy when a proxy sets it, and a direct client
  // can send anything, so the value is validated rather than passed through.
  // 'NO' is deliberately absent from this list: it is Norway, and trusting it
  // is the correct behaviour.
  for (const value of ['XX', 'ZZ', 'PRT', '', 'x', '../..', '__proto__']) {
    const result = detectFromRequest({ headers: { 'accept-language': 'en-GB', 'cf-ipcountry': value } });
    assert.equal(result.country.source, 'language-region', `${value} should not be trusted`);
    assert.equal(result.country.code, 'GB');
  }
});

test('a tampered cookie cannot inject a language or a country', () => {
  // These values reach cache keys and file paths downstream, so they are
  // validated on the way in, not on the way out.
  const result = detectFromRequest({
    headers: { cookie: 'locale_pref=lang%3D..%2F..%2Fetc%26country%3DZZ' }
  });
  assert.equal(result.language.tag, 'en');
  assert.equal(result.language.source, 'fallback');
  assert.equal(result.country.code, null);
  assert.deepEqual(result.override, { language: false, country: false });
});

test('an empty request still returns a usable shape', () => {
  for (const request of [{}, { headers: {} }, { headers: { 'accept-language': '' } }]) {
    const result = detectFromRequest(request);
    assert.equal(result.language.tag, 'en');
    assert.equal(result.language.dir, 'ltr');
    assert.equal(result.country.code, null);
    // Only the client can report a time zone, so the server never guesses one.
    assert.equal(result.timezone, null);
  }
});

test('the server reports no city unless the edge or the visitor supplied one', () => {
  assert.equal(detectFromRequest({ headers: { 'accept-language': 'pt-PT' } }).city, null);

  const fromEdge = detectFromRequest({ headers: { 'accept-language': 'pt-PT', 'cf-ipcity': 'Porto' } });
  assert.equal(fromEdge.city.name, 'Porto');
  // IP city is metro-level and defeated by VPNs and carrier NAT, so it is
  // labelled rather than presented as fact.
  assert.equal(fromEdge.city.kind, 'ip-geolocation');
  assert.equal(fromEdge.city.confidence, 'low');

  const stated = detectFromRequest({ headers: { cookie: 'locale_pref=lang%3Dpt%26city%3DBraga' } });
  assert.equal(stated.city.name, 'Braga');
  assert.equal(stated.city.kind, 'stated');
});

test('a header array, as some servers produce, is handled', () => {
  const result = detectFromRequest({ headers: { 'accept-language': ['pt-PT', 'en'] } });
  assert.equal(result.language.tag, 'pt-PT');
});

test('an RTL language sets the direction the page needs', () => {
  assert.equal(detectFromRequest({ headers: { 'accept-language': 'ar-EG' } }).language.dir, 'rtl');
  assert.equal(detectFromRequest({ headers: { 'accept-language': 'fa-IR' } }).language.dir, 'rtl');
});

test('restricting the available languages falls back to one that exists', () => {
  const result = detectFromRequest(
    { headers: { 'accept-language': 'ja' } },
    { available: ['en', 'pt-PT'], fallback: 'en' }
  );
  assert.equal(result.language.tag, 'en');
  assert.equal(result.language.source, 'fallback');
});

test('the raw signals are reported for logging', () => {
  const result = detectFromRequest({
    headers: { 'accept-language': 'pt-PT', 'cf-ipcountry': 'PT', cookie: 'locale_pref=lang%3Dde' }
  });
  assert.equal(result.signals.acceptLanguage, 'pt-PT');
  assert.deepEqual(result.signals.geoHeader, { name: 'cf-ipcountry', value: 'PT' });
  assert.equal(result.signals.cookieLanguage, 'de');
});
