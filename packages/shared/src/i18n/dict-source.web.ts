// WHERE THE DICTIONARY COMES FROM — the web.
//
// The site used to carry all six dictionaries in its one start bundle: ~690 KB
// of gzip, of which a visitor reads one language or none (Russian needs no
// dictionary). Each language is now its own chunk — `import()` makes Metro
// split it out, named by content hash and cached as immutable like the rest
// of `/_expo/static`. The entry (`apps/mobile/index.web.js`) waits for the
// active one before the app's code runs: the build-time plugin translates
// literals while modules are still being evaluated, so a dictionary that came
// later would leave those strings in Russian.

export type Dictionary = Readonly<Record<string, string>>;

let loaded: { code: string; dict: Dictionary } | null = null;

type JsonModule = { default?: Dictionary } & Dictionary;
const json = (m: unknown): Dictionary => ((m as JsonModule).default ?? (m as Dictionary));

function fetchDictionary(code: string): Promise<Dictionary> | null {
  switch (code) {
    case "en":
      return import("./dict/en.json").then(json);
    case "bg":
      return import("./dict/bg.json").then(json);
    case "el":
      return import("./dict/el.json").then(json);
    case "uk":
      return import("./dict/uk.json").then(json);
    case "de":
      return import("./dict/de.json").then(json);
    case "es":
      return import("./dict/es.json").then(json);
    default:
      return null;
  }
}

/** The preloaded dictionary of this language; `null` for Russian, and for a
 *  language whose chunk did not arrive — the app then reads in Russian
 *  rather than not opening at all. */
export function loadDictionary(code: string): Dictionary | null {
  return loaded?.code === code ? loaded.dict : null;
}

/** Fetches the active language before the app starts. Never rejects: no
 *  network on a cold start must not leave a blank page. */
export async function preloadDictionary(code: string): Promise<void> {
  const pending = fetchDictionary(code);
  if (!pending) return;
  try {
    loaded = { code, dict: await pending };
  } catch {
    loaded = null;
  }
}
