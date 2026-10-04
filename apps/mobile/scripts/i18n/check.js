#!/usr/bin/env node
// UI TRANSLATION — state of the dictionaries against the source.
//
//   node scripts/i18n/check.js                 summary: phrases, missing per language
//   node scripts/i18n/check.js --missing out.json [--all] [--server]
//                                              phrases without a translation (or all
//                                              phrases), with the code lines they come
//                                              from — the work list for translators
//   node scripts/i18n/check.js --logic         literals that act as keys or are compared,
//                                              and literals the plugin keeps raw — review
//                                              these when a screen misbehaves in a language
//   node scripts/i18n/check.js --merge dir/    folds translated chunks ({ phrase: { en, bg … } })
//                                              into packages/shared/src/i18n/dict/*.json
//   node scripts/i18n/check.js --prune         drops dictionary entries no phrase uses any more
//
// A missing translation is not an error — the phrase shows in Russian — so
// nothing here fails a build; it only tells what is left.
"use strict";

const fs = require("fs");
const path = require("path");
const { buildCatalog, loadDictionary, REPO } = require("./catalog");

const LOCALES = ["en", "bg", "el", "uk", "de", "es"];
const DICT_DIR = path.join(REPO, "packages/shared/src/i18n/dict");

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);

function sourceLine(file, line, span = 1) {
  try {
    const lines = fs.readFileSync(path.join(REPO, file), "utf8").split("\n");
    return lines
      .slice(line - 1, line - 1 + span)
      .map((l) => l.trim())
      .join(" ")
      .slice(0, 220);
  } catch {
    return "";
  }
}

const PLACEHOLDER = /\{(\d+)\}/g;
const placeholders = (s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",");
const SMS_TOKENS = /\[[А-Яа-яЁё ]+\]/g;
const tokens = (s) => (s.match(SMS_TOKENS) || []).sort().join(",");

/** A translation is usable when it keeps every value slot and every SMS token
 *  of the source; its outer whitespace is taken from the source. */
function normalize(source, translated) {
  if (typeof translated !== "string") return { ok: false, why: "not a string" };
  const core = translated.trim();
  if (!core && source.trim()) return { ok: false, why: "empty" };
  if (placeholders(source) !== placeholders(core)) return { ok: false, why: `placeholders ${placeholders(source)} ≠ ${placeholders(core)}` };
  if (tokens(source) !== tokens(core)) return { ok: false, why: `sms tokens ${tokens(source)} ≠ ${tokens(core)}` };
  const lead = source.match(/^\s*/)[0];
  const trail = source.match(/\s*$/)[0];
  return { ok: true, value: lead + core + trail };
}

function writeDictionary(locale, dict) {
  const sorted = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
  fs.writeFileSync(path.join(DICT_DIR, `${locale}.json`), JSON.stringify(sorted, null, 1) + "\n");
}

function main() {
  const catalog = buildCatalog();
  // Database messages (scripts/i18n/server-keys.js) are phrases too: the app
  // prints them through `tDynamic`.
  const serverKeys = JSON.parse(fs.readFileSync(path.join(REPO, "packages/shared/src/i18n/server-keys.json"), "utf8"));
  for (const key of serverKeys) {
    if (!catalog.keys.has(key)) catalog.keys.set(key, [{ kind: "server", file: "supabase/migrations", line: 0, key }]);
  }
  // Literals kept raw in code but printed through `tDynamic` (ignore.json,
  // `display: true`) still need a translation.
  const ignore = JSON.parse(fs.readFileSync(path.join(REPO, "packages/shared/src/i18n/ignore.json"), "utf8"));
  for (const [file, list] of Object.entries(ignore.literals || {})) {
    for (const entry of list) {
      if (entry && entry.display && !catalog.keys.has(entry.text)) {
        catalog.keys.set(entry.text, [{ kind: "server", file, line: 0, key: entry.text }]);
      }
    }
  }
  const keys = [...catalog.keys.keys()];

  if (flag("--merge") >= 0) {
    const dir = args[flag("--merge") + 1];
    const dicts = Object.fromEntries(LOCALES.map((l) => [l, { ...loadDictionary(l) }]));
    const problems = [];
    let merged = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      let chunk;
      try {
        chunk = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch (error) {
        problems.push({ file, why: "invalid JSON: " + error.message });
        continue;
      }
      for (const [source, byLocale] of Object.entries(chunk)) {
        for (const locale of LOCALES) {
          const result = normalize(source, byLocale && byLocale[locale]);
          if (!result.ok) {
            problems.push({ file, source, locale, why: result.why, got: byLocale && byLocale[locale] });
            continue;
          }
          dicts[locale][source] = result.value;
          merged++;
        }
      }
    }
    for (const locale of LOCALES) writeDictionary(locale, dicts[locale]);
    console.log(`merged ${merged} translations; ${problems.length} rejected`);
    if (problems.length) {
      const out = path.join(dir, "_rejected.json");
      fs.writeFileSync(out, JSON.stringify(problems, null, 1));
      console.log(`rejected → ${out}`);
    }
    return;
  }

  if (flag("--logic") >= 0) {
    const rows = [];
    for (const [key, list] of catalog.keys) {
      for (const e of list) if (e.kind === "logic") rows.push({ kind: "translated", reason: e.reason, file: e.file, line: e.line, key });
    }
    for (const e of catalog.raw) rows.push({ kind: "raw", reason: e.reason, file: e.file, line: e.line, key: e.key });
    rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    for (const r of rows) console.log(`${r.kind.padEnd(10)} ${r.reason.padEnd(22)} ${r.file}:${r.line}  ${JSON.stringify(r.key).slice(0, 90)}`);
    console.log(`\n${rows.length} rows`);
    return;
  }

  if (flag("--prune") >= 0) {
    for (const locale of LOCALES) {
      const dict = loadDictionary(locale);
      const kept = Object.fromEntries(Object.entries(dict).filter(([k]) => catalog.keys.has(k)));
      console.log(`  ${locale}: dropped ${Object.keys(dict).length - Object.keys(kept).length}`);
      writeDictionary(locale, kept);
    }
    return;
  }

  const missing = {};
  for (const locale of LOCALES) {
    const dict = loadDictionary(locale);
    missing[locale] = keys.filter((k) => !dict[k]);
  }

  if (flag("--missing") >= 0) {
    const out = args[flag("--missing") + 1];
    const all = flag("--all") >= 0;
    const onlyServer = flag("--server") >= 0;
    const pool = onlyServer ? serverKeys : keys;
    const wanted = all ? pool : pool.filter((k) => LOCALES.some((l) => missing[l].includes(k)));
    const rows = wanted.map((key) => {
      const list = catalog.keys.get(key);
      return {
        key,
        uses: list.length,
        context: list.slice(0, 3).map((e) => ({
          at: `${e.file}:${e.line}`,
          kind: e.attr ? `attr:${e.attr}` : e.kind,
          // JSX text starts right after `>` — the words are on the next lines.
          code: e.kind === "server" ? "error message raised by a database function, shown in a toast" : sourceLine(e.file, e.line, e.kind === "text" || e.kind === "jsx" ? 3 : 1),
        })),
      };
    });
    fs.writeFileSync(out, JSON.stringify(rows, null, 1));
    console.log(`${rows.length} phrases → ${out}`);
    return;
  }

  console.log(`${catalog.files} files, ${keys.length} phrases`);
  for (const locale of LOCALES) {
    const dict = loadDictionary(locale);
    const stale = Object.keys(dict).filter((k) => !catalog.keys.has(k)).length;
    console.log(`  ${locale}: ${keys.length - missing[locale].length} translated, ${missing[locale].length} missing, ${stale} unused`);
  }
  if (catalog.errors.length) console.log("parse errors:", catalog.errors);
}

main();
