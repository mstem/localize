// Writing direction for a tag. A closed list beats a lookup: the set of
// right-to-left scripts in real use is small and changes about never.

// Script subtags are checked first, so ku-Arab is rtl while ku-Latn is ltr.
const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Nkoo', 'Adlm', 'Syrc', 'Samr', 'Mand']);

// Languages whose default script is right-to-left, for tags that carry no
// script subtag of their own.
const RTL_LANGUAGES = new Set([
  'ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ji', 'ks', 'ku',
  'ps', 'sd', 'ug', 'ur', 'yi'
]);

import { parseLanguageTag } from './language-tag.js';

/** @returns {'ltr'|'rtl'} ltr for anything unrecognised. */
export function dirForLanguage(tag) {
  const parsed = parseLanguageTag(tag);
  if (!parsed) return 'ltr';
  if (parsed.script) return RTL_SCRIPTS.has(parsed.script) ? 'rtl' : 'ltr';
  return RTL_LANGUAGES.has(parsed.language) ? 'rtl' : 'ltr';
}
