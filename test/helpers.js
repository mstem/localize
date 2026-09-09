// Stubs standing in for the browser. The package takes every ambient global as
// a parameter precisely so this file can exist: no jsdom, no Playwright, no
// headless browser in CI for what is a few hundred lines of pure logic.

/** A document.cookie that behaves like the real one: read all, write one. */
export function cookieJar(initial = '') {
  const store = new Map();
  if (initial) {
    for (const pair of initial.split('; ')) {
      const eq = pair.indexOf('=');
      if (eq > 0) store.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  return {
    get cookie() {
      return [...store].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(value) {
      const [pair, ...attributes] = value.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) return;
      const name = pair.slice(0, eq).trim();
      if (attributes.some((a) => /max-age\s*=\s*0/i.test(a))) {
        store.delete(name);
        return;
      }
      store.set(name, pair.slice(eq + 1).trim());
    },
    written: attributesOf(store)
  };
}

function attributesOf(store) {
  return () => [...store.keys()];
}

export function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    get size() {
      return store.size;
    }
  };
}

/** Storage that throws on every access, as it does in some privacy modes. */
export function hostileStorage() {
  const boom = () => {
    throw new Error('storage is blocked');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

export function intlReporting(timeZone) {
  return { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) };
}

export function intlThrowing() {
  return {
    DateTimeFormat: () => {
      throw new Error('Intl is unavailable');
    }
  };
}

/** No cookies, no storage, so a test only exercises what it means to. */
export function noPersistence() {
  return { document: cookieJar(), localStorage: memoryStorage() };
}
