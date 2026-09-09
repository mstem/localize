// Time zone to country. There is no runtime API for this direction:
// Intl.Locale.prototype.getTimeZones() maps a region to its zones and returns
// undefined without a region subtag, so the table has to ship.
import { PACKED_ZONE_COUNTRY } from '../data/zone-country.js';
import { PACKED_ZONE_ALIAS } from '../data/zone-alias.js';
export { TZDATA_VERSION } from '../data/version.js';

// Parsed on first use, not at import, so requiring the module costs nothing
// until something asks a question. Null prototypes because the keys are
// attacker-supplied strings and a '__proto__' probe must miss.
let zoneCountry = null;
let zoneAlias = null;

function unpack(packed) {
  const map = new Map();
  for (const group of packed.split(';')) {
    const colon = group.indexOf(':');
    const key = group.slice(0, colon);
    for (const value of group.slice(colon + 1).split(',')) map.set(value, key);
  }
  return map;
}

function tables() {
  if (!zoneCountry) {
    zoneCountry = unpack(PACKED_ZONE_COUNTRY);
    zoneAlias = unpack(PACKED_ZONE_ALIAS);
  }
  return { zoneCountry, zoneAlias };
}

function clean(tz) {
  if (typeof tz !== 'string') return null;
  const trimmed = tz.trim();
  // A zone name is region/city, ASCII, no traversal. Anything else is not a
  // zone, and this is the guard that keeps a hostile string out of a Map lookup
  // that a caller might later use to build a cache key.
  if (!/^[A-Za-z0-9_+/-]{3,64}$/.test(trimmed)) return null;
  return trimmed;
}

/** The canonical spelling of a zone, or the input unchanged if it is not an alias. */
export function canonicalizeTimeZone(tz) {
  const zone = clean(tz);
  if (!zone) return null;
  return tables().zoneAlias.get(zone) ?? zone;
}

/**
 * Country for a zone.
 *
 * The lookup order is the whole point. zone.tab keeps the microstate zone
 * names, so Europe/Vaduz is listed directly as LI. Resolving the alias first
 * would send it through Europe/Zurich and answer CH. Same for Europe/Vatican
 * (IT), Arctic/Longyearbyen (DE) and Europe/Mariehamn (FI). Direct hit wins.
 *
 * Aliases are still needed second, because ICU deliberately does not normalise
 * the names that matter: a browser can report Asia/Calcutta or Europe/Kiev,
 * neither of which appears in zone.tab. Without this step, detection fails for
 * India and Ukraine.
 *
 * A direct hit is high confidence even for a zone zone1970.tab shares between
 * countries: zone.tab names the primary one, and every co-tenant has a zone
 * name of its own that its machines report instead. See scripts/build-data.js.
 *
 * @returns {{country: string|null, zone: string|null, canonicalZone: string|null,
 *   via: 'zone-table'|'alias'|null,
 *   confidence: 'high'|'medium'|'none'}}
 */
export function countryFromTimeZone(tz) {
  const miss = { country: null, zone: null, canonicalZone: null, via: null, confidence: 'none' };
  const zone = clean(tz);
  if (!zone) return miss;

  const { zoneCountry, zoneAlias } = tables();

  const direct = zoneCountry.get(zone);
  if (direct) {
    return {
      country: direct,
      zone,
      canonicalZone: zoneAlias.get(zone) ?? zone,
      via: 'zone-table',
      confidence: 'high'
    };
  }

  const canonical = zoneAlias.get(zone);
  const viaAlias = canonical && zoneCountry.get(canonical);
  if (viaAlias) {
    return {
      country: viaAlias,
      zone,
      canonicalZone: canonical,
      via: 'alias',
      confidence: 'medium'
    };
  }

  return { ...miss, zone, canonicalZone: canonical ?? zone };
}

/**
 * The zone's principal location. This is NOT the visitor's city: every zone has
 * exactly one, so all of Portugal reads as Lisbon and Houston reads as Chicago.
 * The kind field says so, and callers are expected to pass it on rather than
 * quietly presenting it as a city.
 *
 * Only zones that actually resolve to a country get a name, so a non-zone
 * cannot produce a plausible-looking location: '__proto__' would otherwise
 * render as 'proto'.
 *
 * The canonical spelling supplies the name only when it is in the same country,
 * which gives the current name for a renamed city (Asia/Calcutta -> Kolkata,
 * US/Pacific -> Los Angeles) without ever crossing a border. Following the link
 * regardless would rename Europe/Vaduz to Zurich and Africa/Asmera to Nairobi,
 * since a tzdb link means same clock, not same place.
 */
export function cityFromTimeZone(tz) {
  const resolved = countryFromTimeZone(tz);
  if (!resolved.country) return null;
  const canonical = resolved.canonicalZone;
  const sameCountry = canonical && canonical !== resolved.zone
    && countryFromTimeZone(canonical).country === resolved.country;
  const zone = sameCountry ? canonical : resolved.zone;
  if (/^(UTC|GMT|Etc\/)/i.test(zone)) return null;
  const last = zone.split('/').pop();
  if (!last || last.length <= 3) return null;
  return { name: last.replace(/_/g, ' '), kind: 'timezone-representative' };
}
