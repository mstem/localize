import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptLanguage, negotiateLanguage } from '../src/accept-language.js';

const tags = (header, options) => parseAcceptLanguage(header, options).map((e) => `${e.tag}@${e.q}`);

test('parseAcceptLanguage orders by q, highest first', () => {
  assert.deepEqual(tags('pt-PT,pt;q=0.9,en;q=0.8'), ['pt-PT@1', 'pt@0.9', 'en@0.8']);
  assert.deepEqual(tags('en;q=0.2,fr;q=0.9'), ['fr@0.9', 'en@0.2']);
});

test('parseAcceptLanguage keeps the client order within equal q', () => {
  assert.deepEqual(tags('de;q=0.5,en;q=0.5,fr;q=0.5'), ['de@0.5', 'en@0.5', 'fr@0.5']);
  assert.deepEqual(tags('fr,de,es'), ['fr@1', 'de@1', 'es@1']);
});

test('parseAcceptLanguage drops the wildcard, which is not a language', () => {
  assert.deepEqual(tags('*'), []);
  assert.deepEqual(tags('en,*;q=0.5'), ['en@1']);
});

test('parseAcceptLanguage drops an entry whose q is malformed', () => {
  // Leaving q at 1 for garbage would let 'en;q=9' outrank a real preference.
  for (const header of ['en;q=abc', 'en;q=1.5', 'en;q=9', 'en;q=-1', 'en;q=']) {
    assert.deepEqual(tags(header), [], `expected ${header} to be dropped`);
  }
});

test('parseAcceptLanguage honours q=0 as not acceptable', () => {
  assert.deepEqual(tags('en;q=0'), []);
  assert.deepEqual(tags('en;q=0,fr;q=1'), ['fr@1']);
});

test('parseAcceptLanguage ignores parameters that are not q', () => {
  assert.deepEqual(tags('en;charset=utf-8'), ['en@1']);
  assert.deepEqual(tags('en;Q=0.3'), ['en@0.3']);
});

test('parseAcceptLanguage survives garbage without throwing', () => {
  const junk = [';;;', ',,,', '   ', '=', 'q=1', String.fromCharCode(13, 10), 'en ', undefined, null, 42, {}];
  for (const header of junk) {
    assert.doesNotThrow(() => parseAcceptLanguage(header));
  }
  assert.deepEqual(tags(''), []);
});

test('parseAcceptLanguage deduplicates equivalent spellings', () => {
  assert.deepEqual(tags('en-US,EN-us;q=0.5'), ['en-US@1']);
});

test('parseAcceptLanguage caps its work on a hostile header', () => {
  // The header is attacker-controlled, so both the bytes read and the entries
  // produced are bounded. Without the cap this is free server work and an
  // unbounded set of downstream cache keys.
  const huge = new Array(50000).fill('de;q=0.5').join(',');
  const started = Date.now();
  const parsed = parseAcceptLanguage(huge);
  assert.ok(parsed.length <= 10, `got ${parsed.length} entries`);
  assert.ok(Date.now() - started < 250, 'parsing should not scale with header length');
  assert.equal(parseAcceptLanguage('fr,de,es,it,pt', { maxEntries: 2 }).length, 2);
  assert.deepEqual(parseAcceptLanguage('fr-FR', { maxLength: 2 }), []);
});

test('negotiateLanguage takes the top entry when anything is acceptable', () => {
  const result = negotiateLanguage('pt-PT,pt;q=0.9');
  assert.equal(result.tag, 'pt-PT');
  assert.equal(result.source, 'accept-language');
  assert.equal(result.confidence, 'high');
});

test('negotiateLanguage falls back from exact tag to language subtag', () => {
  const exact = negotiateLanguage('pt-PT,en;q=0.5', { available: ['en', 'pt-PT'] });
  assert.equal(exact.tag, 'pt-PT');
  assert.equal(exact.matched, 'exact');

  const byLanguage = negotiateLanguage('pt-BR', { available: ['en', 'pt-PT'] });
  assert.equal(byLanguage.tag, 'pt-PT');
  assert.equal(byLanguage.matched, 'language');
  assert.equal(byLanguage.confidence, 'medium');
});

test('negotiateLanguage falls back when nothing matches or nothing is sent', () => {
  for (const header of ['ja', '', undefined, '*']) {
    const result = negotiateLanguage(header, { available: ['en', 'fr'] });
    assert.equal(result.tag, 'en');
    assert.equal(result.source, 'fallback');
    assert.equal(result.confidence, 'low');
  }
  assert.equal(negotiateLanguage('ja', { available: ['fr'], fallback: 'fr' }).tag, 'fr');
});
