// Accept-Language parsing. The header is attacker-controlled, so both the input
// length and the number of entries are capped: without that, a megabyte of
// q-values is a free way to make the server work, and every distinct value is a
// potential new cache key or translation job downstream.
import { parseLanguageTag } from './language-tag.js';

const DEFAULTS = { maxLength: 512, maxEntries: 10 };

/**
 * @returns {Array<{tag: string, language: string, script: string|null,
 *   region: string|null, q: number}>} highest q first, malformed entries
 *   dropped, '*' dropped, deduplicated by tag.
 */
export function parseAcceptLanguage(header, options = {}) {
  const { maxLength, maxEntries } = { ...DEFAULTS, ...options };
  if (typeof header !== 'string' || !header) return [];

  const entries = [];
  const seen = new Set();

  // Truncation happens at a byte count, which can land mid-tag, and a half tag
  // can still be a valid one: 'fr-FR' cut short becomes 'fr'. Dropping the last
  // segment when the header was actually truncated stops the cap from inventing
  // a preference the client never expressed.
  const truncated = header.length > maxLength;
  const parts = header.slice(0, maxLength).split(',');
  if (truncated) parts.pop();

  for (const part of parts) {
    const [rawTag, ...params] = part.split(';');
    const candidate = rawTag.trim();
    // '*' is a wildcard, not a language, and there is nothing to negotiate with.
    if (!candidate || candidate === '*') continue;

    const parsed = parseLanguageTag(candidate);
    if (!parsed) continue;

    let q = 1;
    for (const param of params) {
      if (!/^\s*q\s*=/i.test(param)) continue;
      // A q parameter that is present but not a valid 0..1 weight makes the
      // entry malformed, and it is dropped. The alternative, ignoring the bad
      // parameter and leaving q at 1, would let 'en;q=9' outrank every genuine
      // preference in the header.
      const match = /^\s*q\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(param);
      const value = match ? Number(match[1]) : NaN;
      q = Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
    }
    // q=0 means "not acceptable", whether the client meant it or sent garbage.
    if (q === 0) continue;
    if (seen.has(parsed.tag)) continue;

    seen.add(parsed.tag);
    entries.push({ tag: parsed.tag, language: parsed.language, script: parsed.script, region: parsed.region, q });
    if (entries.length >= maxEntries) break;
  }

  // Stable within equal q, so the client's own ordering survives.
  return entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.q - a.e.q || a.i - b.i).map(({ e }) => e);
}

/**
 * Pick a language from the header.
 *
 * `available: null` means anything goes, which is this project's case: the
 * model handles whatever it is sent, so the top well-formed entry wins. Pass an
 * array to restrict to bundles that exist, and matching falls back from exact
 * tag to language subtag before giving up.
 *
 * @returns {{tag: string, language: string, script: string|null, region: string|null,
 *   source: 'accept-language'|'fallback', matched: 'exact'|'language'|'fallback',
 *   confidence: 'high'|'medium'|'low'}}
 */
export function negotiateLanguage(header, options = {}) {
  const { available = null, fallback = 'en' } = options;
  const parsedFallback = parseLanguageTag(fallback) ?? parseLanguageTag('en');
  const fallbackResult = {
    tag: parsedFallback.tag,
    language: parsedFallback.language,
    script: parsedFallback.script,
    region: parsedFallback.region,
    source: 'fallback',
    matched: 'fallback',
    confidence: 'low'
  };

  const entries = parseAcceptLanguage(header, options);
  if (!entries.length) return fallbackResult;

  const found = (entry, matched, confidence) => ({
    tag: entry.tag,
    language: entry.language,
    script: entry.script,
    region: entry.region,
    source: 'accept-language',
    matched,
    confidence
  });

  if (!available) return found(entries[0], 'exact', 'high');

  const offered = available.map((tag) => parseLanguageTag(tag)).filter(Boolean);
  for (const entry of entries) {
    const exact = offered.find((o) => o.tag === entry.tag);
    if (exact) return found({ ...entry, ...exact }, 'exact', 'high');
  }
  for (const entry of entries) {
    const byLanguage = offered.find((o) => o.language === entry.language);
    if (byLanguage) return found({ ...entry, ...byLanguage }, 'language', 'medium');
  }
  return fallbackResult;
}
