// BCP 47 tag handling, limited to what locale negotiation needs: is this tag
// well formed, what are its subtags, and which translation bundle does it map
// to. No registry lookups, so a well-formed tag for a language nobody speaks
// still parses. Rejecting those is the caller's job, not the grammar's.

const MAX_TAG_LENGTH = 64;

/**
 * @returns {{language: string, script: string|null, region: string|null,
 *   variants: string[], tag: string}|null} null when the tag is not well formed.
 */
export function parseLanguageTag(tag) {
  if (typeof tag !== 'string') return null;
  const trimmed = tag.trim();
  if (!trimmed || trimmed.length > MAX_TAG_LENGTH) return null;

  const parts = trimmed.split(/[-_]/);
  const language = parts.shift();
  // 4-letter and 5-to-8-letter primary subtags are reserved or registered, but
  // they are well formed, so they parse rather than being rejected here.
  if (!/^[A-Za-z]{2,8}$/.test(language)) return null;

  let script = null;
  let region = null;
  const variants = [];

  let i = 0;
  if (i < parts.length && /^[A-Za-z]{4}$/.test(parts[i])) script = parts[i++];
  if (i < parts.length && /^([A-Za-z]{2}|\d{3})$/.test(parts[i])) region = parts[i++];
  while (i < parts.length) {
    const part = parts[i];
    // A singleton opens an extension or private-use sequence; everything after
    // it is irrelevant to negotiation, so the parse stops rather than failing.
    if (part.length === 1) break;
    if (!/^([A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3})$/.test(part)) return null;
    variants.push(part.toLowerCase());
    i++;
  }

  const canonical = [
    language.toLowerCase(),
    script && script[0].toUpperCase() + script.slice(1).toLowerCase(),
    region && region.toUpperCase(),
    ...variants
  ].filter(Boolean).join('-');

  return {
    language: language.toLowerCase(),
    script: script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : null,
    region: region ? region.toUpperCase() : null,
    variants,
    tag: canonical
  };
}

/** 'PT-pt' -> 'pt-PT', 'zh_hans_cn' -> 'zh-Hans-CN'. null when not well formed. */
export function canonicalizeTag(tag) {
  return parseLanguageTag(tag)?.tag ?? null;
}

/**
 * The key a translation bundle is stored under: language plus script, never
 * region. This is the cost control. pt-PT and pt-BR share one bundle, so the
 * roughly 8,000 tags a browser might send collapse to a few hundred keys, while
 * zh-Hant and zh-Hans stay apart because they are genuinely different text.
 */
export function bundleKey(tag) {
  const parsed = parseLanguageTag(tag);
  if (!parsed) return null;
  return parsed.script ? `${parsed.language}-${parsed.script}` : parsed.language;
}
