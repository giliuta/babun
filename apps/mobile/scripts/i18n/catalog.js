// Runs the SAME babel plugin Metro runs, in collect mode, over every source
// file — so the list of keys here is exactly the list the app looks up.
"use strict";

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const plugin = require("./babel-plugin");

const { REPO, fileInScope } = plugin;
const ROOTS = ["apps/mobile/src", "apps/mobile/app", "packages/shared/src"];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * @returns {{ keys: Map<string, Array<object>>, raw: Array<object>, files: number, errors: Array<object> }}
 */
function buildCatalog() {
  const files = ROOTS.flatMap((r) => walk(path.join(REPO, r), [])).filter(fileInScope);
  const keys = new Map();
  const raw = [];
  const errors = [];
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const collect = (entry) => {
      if (entry.kind === "raw") {
        raw.push(entry);
        return;
      }
      if (!keys.has(entry.key)) keys.set(entry.key, []);
      keys.get(entry.key).push(entry);
    };
    try {
      babel.transformSync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        code: false,
        ast: false,
        parserOpts: { plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] },
        plugins: [[plugin, { collect }]],
      });
    } catch (error) {
      errors.push({ file: path.relative(REPO, file), message: String(error.message).split("\n")[0] });
    }
  }
  return { keys, raw, files: files.length, errors };
}

function loadDictionary(locale) {
  const file = path.join(REPO, "packages/shared/src/i18n/dict", `${locale}.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = { buildCatalog, loadDictionary, REPO };
