import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFromTimeZone } from '../src/timezone.js';
import { countryCodes, normalizeCountry } from '../src/country.js';

test('every time zone this runtime knows resolves to a country', () => {
  // The highest-value test in the package, and it needs no browser and no
  // network. ICU ships its own zone list, so when tzdata adds or renames a zone
  // and the committed snapshot is not regenerated, this fails in CI instead of
  // silently returning null for real visitors.
  const zones = Intl.supportedValuesOf('timeZone');
  assert.ok(zones.length > 400, `expected a full zone list, got ${zones.length}`);

  const unresolved = zones.filter((zone) => !countryFromTimeZone(zone).country);
  assert.deepEqual(
    unresolved,
    [],
    `these zones resolve to no country, so data/ needs regenerating with npm run build-data: ${unresolved.join(', ')}`
  );
});

test('the zone list and the table agree on which country a zone belongs to', () => {
  // Cross-checks the shipped table against ICU's own region data, in the one
  // direction the platform offers. Skipped rather than failed on older ICU.
  if (typeof Intl.Locale.prototype.getTimeZones !== 'function') return;

  const mismatches = [];
  for (const code of countryCodes()) {
    let expected;
    try {
      expected = new Intl.Locale(`und-${code}`).getTimeZones();
    } catch {
      continue;
    }
    if (!expected || !expected.length) continue;
    const resolved = expected.map((zone) => countryFromTimeZone(zone).country);
    if (!resolved.includes(code)) {
      mismatches.push(`${code}: ICU says ${expected.join('/')}, table says ${resolved.join('/')}`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join(' | '));
});

test('the country set covers the inhabited world', () => {
  const codes = countryCodes();
  assert.ok(codes.size >= 240, `expected about 247 countries, got ${codes.size}`);
  for (const code of ['PT', 'BE', 'LU', 'LI', 'VA', 'IN', 'UA', 'JP', 'US', 'BF']) {
    assert.ok(codes.has(code), `${code} should be known`);
  }
  // Bouvet Island and Heard/McDonald are uninhabited and have no zone.
  assert.equal(codes.has('BV'), false);
  assert.equal(codes.has('HM'), false);
});

test('normalizeCountry accepts a real code in any case and rejects the rest', () => {
  assert.equal(normalizeCountry('pt'), 'PT');
  assert.equal(normalizeCountry('  Pt  '), 'PT');
  for (const bad of ['XX', 'ZZ', '', 'P', 'PRT', '../', '__proto__', null, undefined, 42, {}]) {
    assert.equal(normalizeCountry(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});
