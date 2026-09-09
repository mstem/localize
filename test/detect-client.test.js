import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClient } from '../src/detect-client.js';
import { cookieJar, memoryStorage, hostileStorage, intlReporting, intlThrowing, noPersistence } from './helpers.js';

const detect = (navigator, timeZone, extra = {}) =>
  detectClient({ navigator, intl: intlReporting(timeZone), ...noPersistence(), ...extra });

test('two agreeing signals earn high confidence', () => {
  const result = detect({ languages: ['pt-PT', 'pt'], language: 'pt-PT' }, 'Europe/Lisbon');
  assert.equal(result.language.tag, 'pt-PT');
  assert.equal(result.language.source, 'navigator.languages');
  assert.equal(result.country.code, 'PT');
  assert.equal(result.country.confidence, 'high');
  assert.equal(result.country.agreesWithLanguageRegion, true);
});

test('disagreeing signals keep the time zone but lower confidence', () => {
  // A French speaker in Burkina Faso whose machine reports Abidjan. The zone
  // answers Ivory Coast and the locale says Burkina Faso; one of them is wrong
  // and nothing here can tell which, so the caller is told to ask.
  const result = detect({ languages: ['fr-BF'] }, 'Africa/Abidjan');
  assert.equal(result.country.code, 'CI');
  assert.equal(result.country.source, 'timezone');
  assert.equal(result.country.confidence, 'low');
  assert.equal(result.country.agreesWithLanguageRegion, false);
});

test('a language with no region subtag leaves nothing to corroborate', () => {
  const result = detect({ languages: ['de'] }, 'Europe/Berlin');
  assert.equal(result.country.code, 'DE');
  assert.equal(result.country.confidence, 'medium');
  assert.equal(result.country.agreesWithLanguageRegion, null);
});

test('ordinary European visitors are not flagged as uncertain', () => {
  // The zones below are all shared with a neighbour in zone1970.tab. Treating
  // that as ambiguity would show a confirmation prompt to most of Europe.
  const cases = [
    [['de-DE'], 'Europe/Berlin', 'DE'],
    [['nl-BE'], 'Europe/Brussels', 'BE'],
    [['it-IT'], 'Europe/Rome', 'IT'],
    [['ja-JP'], 'Asia/Tokyo', 'JP'],
    [['fr-LU'], 'Europe/Luxembourg', 'LU'],
    [['de-LI'], 'Europe/Vaduz', 'LI']
  ];
  for (const [languages, timeZone, expected] of cases) {
    const result = detect({ languages }, timeZone);
    assert.equal(result.country.code, expected, `${timeZone} should be ${expected}`);
    assert.equal(result.country.confidence, 'high', `${timeZone} should be confident`);
  }
});

test('navigator.language covers a browser with no languages list', () => {
  const result = detect({ language: 'ja-JP' }, 'Asia/Tokyo');
  assert.equal(result.language.tag, 'ja-JP');
  assert.equal(result.language.source, 'navigator.language');
  assert.equal(result.country.code, 'JP');
});

test('the first well-formed tag wins when the browser reports junk first', () => {
  const result = detect({ languages: ['', 'not a tag', 'fr-FR'] }, 'Europe/Paris');
  assert.equal(result.language.tag, 'fr-FR');
});

test('direction comes from the detected language', () => {
  assert.equal(detect({ languages: ['ar-EG'] }, 'Africa/Cairo').language.dir, 'rtl');
  assert.equal(detect({ languages: ['he-IL'] }, 'Asia/Jerusalem').language.dir, 'rtl');
  assert.equal(detect({ languages: ['en-US'] }, 'America/New_York').language.dir, 'ltr');
});

test('an unusable time zone falls back to the language region', () => {
  const result = detect({ languages: ['en-US'] }, 'not/a/zone');
  assert.equal(result.country.code, 'US');
  assert.equal(result.country.source, 'language-region');
  assert.equal(result.country.confidence, 'low');
  assert.equal(result.timezone, null);
});

test('an Intl that throws does not take the page down', () => {
  const result = detectClient({
    navigator: { languages: ['en-GB'] },
    intl: intlThrowing(),
    ...noPersistence()
  });
  assert.equal(result.language.tag, 'en-GB');
  assert.equal(result.country.code, 'GB');
  assert.equal(result.timezone, null);
});

test('nothing detectable still returns a usable shape', () => {
  const result = detectClient({ navigator: {}, intl: {}, ...noPersistence() });
  assert.equal(result.language.tag, 'en');
  assert.equal(result.language.source, 'fallback');
  assert.equal(result.language.confidence, 'low');
  assert.equal(result.country.code, null);
  assert.equal(result.country.confidence, 'none');
  assert.equal(result.city, null);
  assert.deepEqual(result.override, { language: false, country: false });
});

test('a stated preference beats both detected signals', () => {
  const result = detect({ languages: ['pt-PT'] }, 'Europe/Lisbon', {
    document: cookieJar('locale_pref=lang%3Dar%26country%3DMA')
  });
  assert.equal(result.language.tag, 'ar');
  assert.equal(result.language.source, 'override');
  assert.equal(result.language.dir, 'rtl');
  assert.equal(result.country.code, 'MA');
  assert.equal(result.country.source, 'override');
  assert.deepEqual(result.override, { language: true, country: true });
});

test('the city is reported as the zone location it actually is', () => {
  const result = detect({ languages: ['pt-PT'] }, 'Europe/Lisbon');
  assert.equal(result.city.name, 'Lisbon');
  assert.equal(result.city.kind, 'timezone-representative');
  assert.equal(result.city.confidence, 'low');
});

test('a city the visitor typed is trusted over the zone', () => {
  const result = detect({ languages: ['en-US'] }, 'America/Chicago', {
    document: cookieJar('locale_pref=lang%3Den-US%26country%3DUS%26city%3DHouston')
  });
  // Houston resolves to America/Chicago, so without this the visitor would be
  // told they are in Chicago.
  assert.equal(result.city.name, 'Houston');
  assert.equal(result.city.kind, 'stated');
  assert.equal(result.city.confidence, 'high');
});

test('storage that throws is survivable', () => {
  const result = detectClient({
    navigator: { languages: ['fr-FR'] },
    intl: intlReporting('Europe/Paris'),
    document: cookieJar(),
    localStorage: hostileStorage()
  });
  assert.equal(result.language.tag, 'fr-FR');
  assert.equal(result.country.code, 'FR');
});

test('a preference in localStorage is honoured when cookies are gone', () => {
  const result = detectClient({
    navigator: { languages: ['en-US'] },
    intl: intlReporting('America/New_York'),
    document: cookieJar(),
    localStorage: memoryStorage({ locale_pref: 'lang=de-DE&country=DE' })
  });
  assert.equal(result.language.tag, 'de-DE');
  assert.equal(result.country.code, 'DE');
});
