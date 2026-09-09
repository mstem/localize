import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFromTimeZone, cityFromTimeZone, canonicalizeTimeZone, TZDATA_VERSION } from '../src/timezone.js';

test('a zone listed directly in the table wins over its alias target', () => {
  // This is the whole reason the lookup order is what it is. zone.tab lists the
  // microstates directly, but tzdb links them to a neighbour's zone. Resolving
  // the alias first would answer with the wrong country.
  const cases = [
    ['Europe/Vaduz', 'LI'],        // alias target is Europe/Zurich (CH)
    ['Europe/Vatican', 'VA'],      // alias target is Europe/Rome (IT)
    ['Europe/San_Marino', 'SM'],   // alias target is Europe/Rome (IT)
    ['Arctic/Longyearbyen', 'SJ'], // alias target is Europe/Berlin (DE)
    ['Europe/Mariehamn', 'AX'],    // alias target is Europe/Helsinki (FI)
    ['Europe/Busingen', 'DE']      // alias target is Europe/Zurich (CH)
  ];
  for (const [zone, expected] of cases) {
    const result = countryFromTimeZone(zone);
    assert.equal(result.country, expected, `${zone} should be ${expected}`);
    assert.equal(result.via, 'zone-table');
    assert.equal(result.confidence, 'high');
  }
});

test('the spellings ICU refuses to normalise resolve to the right country', () => {
  // ICU deliberately does not canonicalise these, so a browser may report
  // either. Without them, detection fails outright for India and Ukraine.
  // They are in the table rather than reached through a link, because a link
  // would answer with the country of whatever zone shares their clock.
  const legacy = [['Asia/Calcutta', 'IN'], ['Europe/Kiev', 'UA'], ['Asia/Saigon', 'VN'], ['Africa/Asmera', 'ER'], ['America/Coral_Harbour', 'CA'], ['Pacific/Truk', 'FM']];
  for (const [zone, expected] of legacy) {
    const result = countryFromTimeZone(zone);
    assert.equal(result.country, expected, `${zone} should be ${expected}`);
    assert.equal(result.confidence, 'high');
  }
  // The current spellings resolve too.
  assert.equal(countryFromTimeZone('Asia/Kolkata').country, 'IN');
  assert.equal(countryFromTimeZone('Europe/Kyiv').country, 'UA');
  assert.equal(countryFromTimeZone('Africa/Asmara').country, 'ER');
});

test('a legacy name outside the zone list still resolves through its link', () => {
  // These are not in zone.tab and not in ICU's list either, so the link table
  // is the only thing that can answer. It is right whenever the link stays
  // inside one country, which is the common case.
  for (const [zone, expected] of [['US/Pacific', 'US'], ['Australia/Canberra', 'AU'], ['Brazil/East', 'BR']]) {
    const result = countryFromTimeZone(zone);
    assert.equal(result.country, expected, `${zone} should be ${expected}`);
    assert.equal(result.via, 'alias');
    assert.equal(result.confidence, 'medium');
  }
});

test('a zone shared between countries still answers with its primary country', () => {
  // zone1970.tab groups countries whose clocks agreed since 1970, which is not
  // detection ambiguity: every co-tenant has its own zone name that its
  // machines report instead. Downgrading these would flag most of Europe.
  const shared = [['Europe/Brussels', 'BE'], ['Europe/Berlin', 'DE'], ['Europe/Rome', 'IT'], ['Asia/Tokyo', 'JP'], ['Europe/Prague', 'CZ']];
  for (const [zone, expected] of shared) {
    const result = countryFromTimeZone(zone);
    assert.equal(result.country, expected);
    assert.equal(result.confidence, 'high');
  }
  // ...and the co-tenants resolve to themselves through their own names.
  assert.equal(countryFromTimeZone('Europe/Luxembourg').country, 'LU');
  assert.equal(countryFromTimeZone('Europe/Amsterdam').country, 'NL');
  assert.equal(countryFromTimeZone('Europe/Bratislava').country, 'SK');
});

test('countryFromTimeZone returns no country rather than guessing', () => {
  for (const value of ['', 'UTC', 'GMT', 'Etc/GMT+3', 'not/a/zone', 'Mars/Olympus_Mons', null, undefined, 42, {}]) {
    const result = countryFromTimeZone(value);
    assert.equal(result.country, null, `expected no country for ${JSON.stringify(value)}`);
    assert.equal(result.confidence, 'none');
  }
});

test('a prototype probe cannot reach through the lookup table', () => {
  // The zone name is attacker-supplied and may end up in a cache key, so a
  // lookup must miss rather than returning an inherited property.
  for (const probe of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(countryFromTimeZone(probe).country, null, `${probe} should miss`);
    assert.equal(cityFromTimeZone(probe), null, `${probe} should have no city`);
  }
});

test('a zone name that is really a path traversal is rejected', () => {
  for (const attempt of ['../../etc/passwd', 'Europe/../../../etc', 'Europe/Lisbon;rm -rf /', 'Europe/Lisbon/../Berlin']) {
    assert.equal(countryFromTimeZone(attempt).country, null, `${attempt} should be rejected`);
  }
  // Surrounding whitespace is trimmed rather than rejected, since a stray space
  // is a formatting slip and not an attack.
  assert.equal(countryFromTimeZone('  Europe/Lisbon  ').country, 'PT');
});

test('canonicalizeTimeZone resolves an alias and leaves everything else alone', () => {
  assert.equal(canonicalizeTimeZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(canonicalizeTimeZone('Europe/Kiev'), 'Europe/Kyiv');
  assert.equal(canonicalizeTimeZone('Europe/Lisbon'), 'Europe/Lisbon');
  assert.equal(canonicalizeTimeZone('not/a/zone'), 'not/a/zone');
  assert.equal(canonicalizeTimeZone(''), null);
});

test('cityFromTimeZone labels its own imprecision', () => {
  const lisbon = cityFromTimeZone('Europe/Lisbon');
  assert.equal(lisbon.name, 'Lisbon');
  // The kind matters more than the name. It is the zone's principal location,
  // not the visitor's city, and a caller must be able to tell.
  assert.equal(lisbon.kind, 'timezone-representative');
  assert.equal(cityFromTimeZone('America/New_York').name, 'New York');
  assert.equal(cityFromTimeZone('America/Argentina/Buenos_Aires').name, 'Buenos Aires');
});

test('cityFromTimeZone follows a rename but never crosses a border', () => {
  // Same country, so the current name wins over the one the browser sent.
  assert.equal(cityFromTimeZone('Asia/Calcutta').name, 'Kolkata');
  assert.equal(cityFromTimeZone('US/Pacific').name, 'Los Angeles');
  assert.equal(cityFromTimeZone('Asia/Saigon').name, 'Ho Chi Minh');
  // Different country, so the link is ignored: a tzdb link means same clock,
  // not same place.
  assert.equal(cityFromTimeZone('Europe/Vaduz').name, 'Vaduz');
  assert.equal(cityFromTimeZone('Europe/Vatican').name, 'Vatican');
  assert.equal(cityFromTimeZone('Africa/Asmera').name, 'Asmera');
  assert.equal(cityFromTimeZone('America/Coral_Harbour').name, 'Coral Harbour');
});

test('cityFromTimeZone gives nothing for a zone with no place in it', () => {
  for (const value of ['UTC', 'GMT', 'Etc/GMT+3', 'Etc/UTC', 'not/a/zone', '', null]) {
    assert.equal(cityFromTimeZone(value), null, `expected no city for ${JSON.stringify(value)}`);
  }
});

test('the shipped tzdata version is recorded', () => {
  // Logged at boot so a stale snapshot is visible rather than silent.
  assert.match(TZDATA_VERSION, /^[0-9]{4}[a-z]$/);
});
