// TRANSLATION AT RUNTIME — what the build-time plugin wires every Russian
// literal to (apps/mobile/scripts/i18n/babel-plugin.js). Nobody calls these by
// hand: the source keeps its Russian text, and the plugin turns it into
//   t("Клиент")                    → "Client"
//   tf("Удалить «{0}»?", [name])   → "Delete «Anna»?"
//   tj("Всего {0} записей", [n])   → the same, but values may be React nodes
//
// The Russian text is the key; a phrase missing from the dictionary falls back
// to it, so a string written today shows in Russian until it is translated
// rather than breaking the screen.
import { createElement, Fragment, type ReactNode } from "react";

import { uiIntlTag, uiLocale } from "./locale";
import type { UiLocale } from "./locales";

type Dictionary = Readonly<Record<string, string>>;

let dictionary: Dictionary | null = null;
let loadedFor: UiLocale | null = null;

/* eslint-disable @typescript-eslint/no-require-imports */
function load(code: UiLocale): Dictionary | null {
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
    case "ru":
      return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

function active(): Dictionary | null {
  const code = uiLocale();
  if (code !== loadedFor) {
    loadedFor = code;
    try {
      dictionary = load(code);
    } catch {
      dictionary = null;
    }
  }
  return dictionary;
}

function lookup(source: string): string {
  const dict = active();
  return (dict && dict[source]) || source;
}

const PLACEHOLDER = /\{(\d+)\}/g;

/** A plain phrase. */
export function t(source: string): string {
  return lookup(source);
}

/** A phrase with values: `{0}`, `{1}` … in the order they appear in Russian;
 *  a translation may move them. Values print the way a template literal would. */
export function tf(pattern: string, args: readonly unknown[]): string {
  return lookup(pattern).replace(PLACEHOLDER, (match, index: string) => {
    const i = Number(index);
    return i < args.length ? String(args[i]) : match;
  });
}

const isText = (value: unknown) =>
  value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint";

/** A JSX phrase — text and `{values}` inside one element. Values that are plain
 *  text fold into one string (what React would have printed); anything else
 *  (an icon, a nested <Text>) keeps its place inside a fragment. */
export function tj(pattern: string, args: readonly unknown[]): ReactNode {
  const text = lookup(pattern);
  if (args.every(isText)) {
    return text.replace(PLACEHOLDER, (match, index: string) => {
      const i = Number(index);
      if (i >= args.length) return match;
      const value = args[i];
      return value == null || typeof value === "boolean" ? "" : String(value);
    });
  }
  const parts: ReactNode[] = [];
  let last = 0;
  for (const found of text.matchAll(PLACEHOLDER)) {
    const i = Number(found[1]);
    if (i >= args.length) continue;
    const start = found.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(args[i] as ReactNode);
    last = start + found[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return createElement(Fragment, null, ...parts);
}

type ServerPattern = { key: string; match: RegExp };
let serverPatterns: ServerPattern[] | null = null;

/** Server messages with values: «Платёж превышает остаток {0} {1}» matches
 *  «Платёж превышает остаток 50 EUR». Built once, only when a non-Russian
 *  language meets a message the dictionary does not know verbatim. */
function patterns(): ServerPattern[] {
  if (serverPatterns) return serverPatterns;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const keys = require("./server-keys.json") as string[];
  serverPatterns = keys
    .filter((key) => key.includes("{0}"))
    .map((key) => ({
      key,
      match: new RegExp(
        "^" + key.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "(.+?)") + "$",
      ),
    }));
  return serverPatterns;
}

/**
 * TEXT THAT CAME FROM OUTSIDE THE BUNDLE — an error raised by the database, a
 * message a server returned. The plugin never saw it, so it is looked up when
 * printed (toasts, empty states): verbatim first, then as a server message
 * with values, then «Prefix: message» by its tail. Unknown text stays as is.
 */
export function tDynamic(text: string): string {
  if (!text || active() === null) return text;
  const exact = lookup(text);
  if (exact !== text) return exact;
  for (const { key, match } of patterns()) {
    const found = match.exec(text);
    if (found) return tf(key, found.slice(1));
  }
  const colon = text.indexOf(": ");
  if (colon > 0) {
    const tail = text.slice(colon + 2);
    const translated = tDynamic(tail);
    if (translated !== tail) return `${text.slice(0, colon)}: ${translated}`;
  }
  return text;
}

let phrases: Set<string> | null = null;
let phrasesFor: Dictionary | null = null;

/**
 * IS THIS TEXT FOR PEOPLE? Several places show a server refusal only when it
 * is a sentence and not driver noise («TypeError: Network request failed»),
 * and they told the two apart by Cyrillic. Our own messages are translated
 * now, so a sentence is also anything that IS a phrase of the dictionary.
 */
export function isHumanText(text: string): boolean {
  if (/[А-Яа-яЁё]/.test(text)) return true;
  const dict = active();
  if (!dict) return false;
  if (phrasesFor !== dict) {
    phrasesFor = dict;
    phrases = new Set(Object.values(dict));
  }
  return phrases?.has(text) ?? false;
}

/** BCP 47 tag that replaced a hard-coded "ru-RU" in date and number formatting. */
export function intlLocale(): string {
  return uiIntlTag();
}
