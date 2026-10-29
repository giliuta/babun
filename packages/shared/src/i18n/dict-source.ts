// WHERE THE DICTIONARY COMES FROM — the phone and `bun test`.
//
// All six dictionaries ship inside the native bundle: the app works offline
// and a language switch is a reload, so a dictionary must never be a download
// away. Only the active one is ever required (the module of every other
// language is never evaluated), so memory and parse time stay the same.
// The web variant — `dict-source.web.ts` — loads one language as its own chunk.

export type Dictionary = Readonly<Record<string, string>>;

/** The dictionary of a language; `null` for Russian — the source text is the key. */
export function loadDictionary(code: string): Dictionary | null {
  switch (code) {
    case "en":
      return require("./dict/en.json") as Dictionary;
    case "bg":
      return require("./dict/bg.json") as Dictionary;
    case "el":
      return require("./dict/el.json") as Dictionary;
    case "uk":
      return require("./dict/uk.json") as Dictionary;
    case "de":
      return require("./dict/de.json") as Dictionary;
    case "es":
      return require("./dict/es.json") as Dictionary;
    default:
      return null;
  }
}

/** On the phone every dictionary is already in the bundle — nothing to wait for. */
export function preloadDictionary(_code: string): Promise<void> {
  return Promise.resolve();
}
