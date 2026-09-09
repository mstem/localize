# localize

Detect a visitor's language and country from the browser or from an HTTP
request. Zero dependencies, no build step, works unchanged in Node and in a
browser.

Every answer carries its own source and confidence, so a caller can tell a
corroborated result from a guess instead of receiving a bare string and having
to trust it.

```js
// In the browser
import { detectClient } from 'localize/client';

const { language, country, city } = detectClient();
// language -> { tag: 'pt-PT', language: 'pt', region: 'PT', dir: 'ltr',
//               source: 'navigator.languages', confidence: 'high' }
// country  -> { code: 'PT', source: 'timezone', confidence: 'high',
//               agreesWithLanguageRegion: true }
// city     -> { name: 'Lisbon', kind: 'timezone-representative', confidence: 'low' }
```

```js
// On the server, before a byte of HTML is written
import { detectFromRequest } from 'localize';

app.get('/', (req, res) => {
  const { language } = detectFromRequest(req);
  res.setHeader('Vary', 'Accept-Language, Cookie');
  res.send(render({ lang: language.tag, dir: language.dir }));
});
```

## Install

There is no npm release. Depend on a release tarball:

```json
"localize": "https://github.com/mstem/localize/releases/download/v1.0.0/localize-1.0.0.tgz"
```

npm fetches remote tarballs natively and records `resolved` and `integrity` in
the lockfile, so `npm ci` stays reproducible. This is deliberately not a
`git+https://` dependency: `node:22-alpine` ships no `git`, so that form fails
inside a Docker build.

## What you actually get

**Language is reliable.** The browser states it outright and it is what the
visitor chose.

**Country is right for the large majority of visitors.** It comes from the time
zone, cross-checked against the language's region subtag. It is wrong in three
situations, and says so through its confidence value:

- The two signals disagree, so one of them is wrong and nothing here can tell
  which. Confidence drops to `low`, the time zone wins, and the caller is
  expected to let the visitor correct it.
- A VPN, or a machine with a deliberately foreign time zone.
- A time zone this snapshot does not know, which yields `null` rather than a
  guess.

**City is not the visitor's city.** It is the time zone's principal location,
and every zone has exactly one, so all of Portugal reads as Lisbon and someone
in Houston reads as Chicago. That is what `kind: 'timezone-representative'`
means, and it should be passed on rather than presented as a city. For real
precision, ask: `writePreference({ city })` stores the answer and it comes back
as `kind: 'stated'`.

Where an edge network supplies a country header, that is used ahead of the time
zone and is better than it. `cf-ipcountry` is sent by Cloudflare once IP
geolocation is on for the zone; `cf-ipcity` and friends need the visitor
location headers transform. Header values are validated against the country
table rather than trusted, because a client talking directly to the origin can
send whatever it likes.

## API

Server-safe, from `localize`:

| Function | Returns |
|---|---|
| `detectFromRequest({ headers, cookies, query }, options)` | language, country, city, override flags, raw signals |
| `parseAcceptLanguage(header, { maxLength, maxEntries })` | entries, highest q first, malformed dropped |
| `negotiateLanguage(header, { available, fallback })` | one language, with how it matched |
| `parseLanguageTag(tag)` / `canonicalizeTag(tag)` / `bundleKey(tag)` | subtags, `pt-PT`, `pt` |
| `dirForLanguage(tag)` | `'ltr'` or `'rtl'` |
| `countryFromTimeZone(tz)` / `cityFromTimeZone(tz)` / `canonicalizeTimeZone(tz)` | country, place, canonical name |
| `normalizeCountry(value)` / `countryCodes()` | a validated code, the known set |
| `parseCookieHeader(header)` | cookies, with no middleware |

Browser, from `localize/client`: `detectClient(options)`, `readPreference`,
`writePreference`, `clearPreference`, plus the pure helpers above.

`detectClient` takes `navigator`, `intl`, `document` and `localStorage` as
options, each defaulting to the real global. That is what lets the whole package
be tested without a browser.

`bundleKey` is the one to reach for when caching translations: it collapses tag
to language plus script, so `pt-PT` and `pt-BR` share a bundle while `zh-Hant`
and `zh-Hans` stay apart. Roughly 8,000 possible tags become a few hundred keys.

## The override

`writePreference` stores an explicit choice in a cookie **and** in
localStorage. The cookie is the one that matters: localStorage is invisible to
the server, so a server-rendered page would otherwise always use
`Accept-Language` and then visibly correct itself once scripts ran. Values are
validated on the way in and again on the way out, so a hand-edited cookie
cannot reach a cache key or a file path.

## Data

`data/` is generated from the IANA time zone database and committed, so the
package needs no network and no dependencies. Regenerate after a tzdata release:

```
npm run build-data
```

Run that on **Node 24 or newer**. It needs `Intl.Locale.prototype.getTimeZones`,
which Node 22 does not have, and the script refuses to run without it rather
than emitting a table with the country corrections silently missing. The tests
and the package itself run fine on Node 18 and up; this applies only to
regenerating the data.

Two decisions in there are worth knowing, because both are counterintuitive and
both were bugs first:

**A tzdb link means "same clock", not "same place".** `America/Coral_Harbour`
is linked to `America/Panama` because they share an offset, but it is in
Canada. Following links for geography answers Panama. Likewise `Africa/Asmera`
(Eritrea, linked to Nairobi) and `Pacific/Truk` (Micronesia, linked to Port
Moresby). So `zone.tab` is cross-checked against ICU's region data at build
time, and any zone ICU knows that `zone.tab` omits is taken from ICU.

**`zone.tab` is used, not `zone1970.tab`.** The newer file groups countries
whose clocks agreed since 1970, so `Europe/Berlin` covers Denmark, Norway and
Sweden. That reads like ambiguity but is not: every co-tenant country has its
own zone name that its machines report instead. Of the 34 grouped rows, zero
have a co-tenant lacking one. Treating them as ambiguous would flag most of
Europe and all of Japan as uncertain for nothing.

## Tests

```
npm test
```

Pure `node:test`, no dependencies, no browser. The most valuable one walks every
zone `Intl.supportedValuesOf('timeZone')` reports and asserts each resolves to a
country, so a tzdata release that outdates the committed snapshot fails in CI
rather than silently returning `null` for real visitors. A second test
cross-checks the table against ICU's region data in the one direction the
platform offers; that is the test that caught Eritrea.

## License

MIT
