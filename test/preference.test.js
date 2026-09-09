import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreference, writePreference, clearPreference, parseCookieHeader } from '../src/preference.js';
import { cookieJar, memoryStorage, hostileStorage } from './helpers.js';

const context = (cookie = '', storage = {}) => ({
  document: cookieJar(cookie),
  localStorage: memoryStorage(storage),
  location: { protocol: 'https:' }
});

test('a written preference reads back', () => {
  const ctx = context();
  writePreference({ language: 'pt-PT', country: 'PT', city: 'Braga' }, ctx);
  const read = readPreference(ctx);
  assert.equal(read.language, 'pt-PT');
  assert.equal(read.country, 'PT');
  assert.equal(read.city, 'Braga');
  assert.equal(read.source, 'cookie');
});

test('the preference goes to a cookie, because the server has to see it', () => {
  // localStorage is invisible to the server, so a server-rendered page would
  // use Accept-Language and then visibly correct itself once scripts ran.
  const ctx = context();
  writePreference({ language: 'de-DE', country: 'DE' }, ctx);
  assert.match(ctx.document.cookie, /locale_pref=/);
  assert.equal(readPreference({ ...ctx, localStorage: memoryStorage() }).source, 'cookie');
});

test('the cookie carries the attributes a preference cookie needs', () => {
  const written = [];
  const doc = {
    get cookie() {
      return '';
    },
    set cookie(value) {
      written.push(value);
    }
  };
  writePreference({ language: 'fr' }, { document: doc, localStorage: memoryStorage(), location: { protocol: 'https:' } });
  assert.match(written[0], /Path=\//);
  assert.match(written[0], /Max-Age=31536000/);
  assert.match(written[0], /SameSite=Lax/);
  assert.match(written[0], /Secure/);
  // Not HttpOnly: the page reads this too.
  assert.equal(/HttpOnly/.test(written[0]), false);
});

test('Secure is left off over plain http, or nothing would persist locally', () => {
  const written = [];
  const doc = { get cookie() { return ''; }, set cookie(value) { written.push(value); } };
  writePreference({ language: 'fr' }, { document: doc, localStorage: memoryStorage(), location: { protocol: 'http:' } });
  assert.equal(/Secure/.test(written[0]), false);
});

test('the cookie wins over localStorage when they disagree', () => {
  const ctx = context('locale_pref=lang%3Dfr%26country%3DFR', { locale_pref: 'lang=de&country=DE' });
  assert.equal(readPreference(ctx).language, 'fr');
});

test('localStorage is the backstop when the cookie is gone', () => {
  const ctx = context('', { locale_pref: 'lang=de-DE&country=DE' });
  const read = readPreference(ctx);
  assert.equal(read.language, 'de-DE');
  assert.equal(read.source, 'localStorage');
});

test('a hand-edited preference is rejected rather than trusted', () => {
  const attempts = [
    'lang=../../etc/passwd&country=PT',
    'lang=pt&country=ZZ',
    'lang=&country=',
    'lang=' + 'a'.repeat(200)
  ];
  for (const raw of attempts) {
    const read = readPreference(context(`locale_pref=${encodeURIComponent(raw)}`));
    if (read.language !== null) assert.match(read.language, /^[a-z]{2,8}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?/);
    if (read.country !== null) assert.match(read.country, /^[A-Z]{2}$/);
  }
});

test('writing nothing usable writes nothing at all', () => {
  const ctx = context();
  assert.equal(writePreference({ language: 'not a tag', country: 'ZZ' }, ctx), null);
  assert.equal(ctx.document.cookie, '');
  assert.equal(readPreference(ctx).source, null);
});

test('a stated city is capped in length', () => {
  const ctx = context();
  writePreference({ language: 'pt', city: 'x'.repeat(500) }, ctx);
  assert.equal(readPreference(ctx).city.length, 80);
});

test('clearPreference removes both copies', () => {
  const ctx = context();
  writePreference({ language: 'pt-PT', country: 'PT' }, ctx);
  clearPreference(ctx);
  const read = readPreference(ctx);
  assert.equal(read.language, null);
  assert.equal(read.source, null);
});

test('storage that throws does not stop the cookie being written', () => {
  const ctx = { document: cookieJar(), localStorage: hostileStorage(), location: { protocol: 'https:' } };
  assert.doesNotThrow(() => writePreference({ language: 'pt-PT' }, ctx));
  assert.equal(readPreference(ctx).language, 'pt-PT');
  assert.doesNotThrow(() => clearPreference(ctx));
});

test('reading with no browser present returns empty rather than throwing', () => {
  const read = readPreference({ document: undefined, localStorage: undefined });
  assert.deepEqual(read, { language: null, country: null, city: null, source: null });
});

test('parseCookieHeader handles the shapes a real header takes', () => {
  assert.deepEqual(parseCookieHeader('a=1; b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseCookieHeader('a=one%20two'), { a: 'one two' });
  assert.deepEqual(parseCookieHeader(''), {});
  assert.deepEqual(parseCookieHeader(undefined), {});
  assert.deepEqual(parseCookieHeader('novalue'), {});
  assert.deepEqual(parseCookieHeader('=leading'), {});
  // A malformed escape is not worth failing a whole request over.
  assert.doesNotThrow(() => parseCookieHeader('a=%E0%A4%A'));
  // First wins, matching how browsers resolve a duplicate name.
  assert.deepEqual(parseCookieHeader('a=1; a=2'), { a: '1' });
});
