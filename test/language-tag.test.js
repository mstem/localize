import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLanguageTag, canonicalizeTag, bundleKey } from '../src/language-tag.js';
import { dirForLanguage } from '../src/direction.js';

test('canonicalizeTag fixes subtag casing and separators', () => {
  assert.equal(canonicalizeTag('PT-pt'), 'pt-PT');
  assert.equal(canonicalizeTag('zh_hans_cn'), 'zh-Hans-CN');
  assert.equal(canonicalizeTag('  EN-us  '), 'en-US');
  assert.equal(canonicalizeTag('de-CH-1901'), 'de-CH-1901');
});

test('canonicalizeTag rejects anything not well formed', () => {
  const bad = ['', 'x', '123', 'e', '-en', 'en-', '../../etc/passwd', 'a'.repeat(65), null, undefined, 42, {}];
  for (const value of bad) {
    assert.equal(canonicalizeTag(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('parseLanguageTag separates script from region', () => {
  assert.deepEqual(parseLanguageTag('zh-Hant-TW'), {
    language: 'zh', script: 'Hant', region: 'TW', variants: [], tag: 'zh-Hant-TW'
  });
  assert.equal(parseLanguageTag('es-419').region, '419');
  assert.equal(parseLanguageTag('pt-PT').script, null);
});

test('parseLanguageTag stops at an extension rather than failing', () => {
  // A calendar or numbering extension is irrelevant to negotiation, so the tag
  // parses down to the part that matters instead of being thrown away.
  assert.equal(parseLanguageTag('en-US-u-ca-gregory').tag, 'en-US');
  assert.equal(parseLanguageTag('de-DE-x-private').tag, 'de-DE');
});

test('bundleKey drops the region but keeps the script', () => {
  // The point is cost: pt-PT and pt-BR share one translation, but zh-Hant and
  // zh-Hans are genuinely different text and must not.
  assert.equal(bundleKey('pt-PT'), 'pt');
  assert.equal(bundleKey('pt-BR'), 'pt');
  assert.equal(bundleKey('zh-Hant-TW'), 'zh-Hant');
  assert.equal(bundleKey('zh-Hans-CN'), 'zh-Hans');
  assert.equal(bundleKey('en'), 'en');
  assert.equal(bundleKey('nonsense!'), null);
});

test('bundleKey output cannot escape a directory', () => {
  // Bundles are read from disk by this key, so its shape is a security boundary.
  for (const attempt of ['../../etc/passwd', 'en/../../x', 'en ', './en', 'en;rm -rf']) {
    const key = bundleKey(attempt);
    if (key !== null) assert.match(key, /^[a-z]{2,8}(-[A-Z][a-z]{3})?$/);
  }
});

test('dirForLanguage reads the script before the language', () => {
  assert.equal(dirForLanguage('ar'), 'rtl');
  assert.equal(dirForLanguage('he-IL'), 'rtl');
  assert.equal(dirForLanguage('fa'), 'rtl');
  assert.equal(dirForLanguage('ur-PK'), 'rtl');
  // An explicit script overrides the language default in both directions.
  assert.equal(dirForLanguage('ku-Arab'), 'rtl');
  assert.equal(dirForLanguage('ku-Latn'), 'ltr');
  assert.equal(dirForLanguage('az-Latn'), 'ltr');
  assert.equal(dirForLanguage('en'), 'ltr');
  assert.equal(dirForLanguage('ja-JP'), 'ltr');
  assert.equal(dirForLanguage('nonsense!'), 'ltr');
});
