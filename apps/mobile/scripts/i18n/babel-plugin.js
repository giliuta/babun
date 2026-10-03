// UI LANGUAGE AT BUILD TIME — every Russian literal of the app goes through the
// dictionary of the chosen language.
//
// Why a babel plugin instead of `t("key")` in every file: the UI is ~900 files
// written by several sessions at once in one shared tree, and new Russian text
// lands every hour. Editing every literal by hand would collide with all of
// them, and every new string written after the sweep would stay Russian. The
// plugin keeps the source as it is (RU in UI, EN in code — AGENTS.md rule 8)
// and wraps the literals while Metro bundles:
//
//   <Text>Клиент</Text>                → <Text>{__i18n_t("Клиент")}</Text>
//   <Text>Всего {n} записей</Text>     → <Text>{__i18n_tj("Всего {0} записей", [n])}</Text>
//   title="Удалить"                    → title={__i18n_t("Удалить")}
//   `Удалить «${name}»?`               → __i18n_tf("Удалить «{0}»?", [name])
//   "Удалить " + name + "?"            → __i18n_tf("Удалить {0}?", [name])
//   toLocaleDateString("ru-RU", …)     → toLocaleDateString(__i18n_locale(), …)
//
// The Russian text is the dictionary key; Russian itself is the identity, so a
// device on Russian runs exactly the code it ran before.
//
// Literals that steer LOGIC stay raw, because the value on the other side of
// them is not translated: comparisons, `case` labels, object keys, string
// methods that search (`includes`, `startsWith`, `split` …), Map/Set keys,
// Supabase filters, logs. `scripts/i18n/check.js` lists every one of them so a
// mismatch («translated label compared with a raw literal») is found by
// reading, not by a user. Opt-outs: a file listed in
// `packages/shared/src/i18n/ignore.json`, a `// i18n-ignore-file` comment, or
// `/* i18n-ignore */` right before a literal.
//
// Tests (`bun test`) do not run babel, so every existing assertion on Russian
// text keeps seeing Russian.
"use strict";

const path = require("path");

const CYRILLIC = /[А-Яа-яЁё]/;
const REPO = path.resolve(__dirname, "../../../..");
const RUNTIME_MODULE = "@babun/shared/i18n/runtime";
const ROOTS = ["apps/mobile/src", "apps/mobile/app", "packages/shared/src"].map(
  (p) => path.join(REPO, p) + path.sep,
);
const I18N_DIR = path.join(REPO, "packages/shared/src/i18n") + path.sep;

const NAMES = {
  t: "__i18n_t",
  tf: "__i18n_tf",
  tj: "__i18n_tj",
  locale: "__i18n_locale",
};

// String methods whose FIRST argument is a pattern or a key, not text.
const KEY_ARG_METHODS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "split",
  "replace",
  "replaceAll",
  "match",
  "matchAll",
  "search",
  "localeCompare",
  "get",
  "has",
  "delete",
  "set",
  "add",
  "getItem",
  "setItem",
  "removeItem",
]);
// Supabase filters — every argument is a column or a stored value.
const FILTER_METHODS = new Set([
  "eq",
  "neq",
  "ilike",
  "like",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "textSearch",
  "filter",
  "or",
  "not",
  "match",
]);
const LOG_OBJECTS = new Set(["console", "Sentry"]);
const LOG_FUNCTIONS = new Set(["captureException", "captureMessage", "addBreadcrumb"]);
const COMPARISON = new Set(["===", "!==", "==", "!="]);
// SMS template fields — `[Имя]` is a token the server substitutes, not a word.
const SMS_TOKEN = /^\[[А-Яа-яЁё ]+\]$/;
// Calls whose first argument is a BCP 47 tag that should follow the UI.
const LOCALE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString", "toLocaleString"]);
const LOCALE_CTORS = new Set(["DateTimeFormat", "NumberFormat", "RelativeTimeFormat", "ListFormat"]);
const RU_TAGS = new Set(["ru", "ru-RU"]);
// JSX attributes that are identifiers, never text.
const RAW_ATTRIBUTES = new Set(["key", "testID", "nativeID", "id", "className", "href"]);

let ignoreConfig = null;
function loadIgnore() {
  if (ignoreConfig) return ignoreConfig;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require(path.join(REPO, "packages/shared/src/i18n/ignore.json"));
    ignoreConfig = { files: raw.files || [], literals: raw.literals || {} };
  } catch {
    ignoreConfig = { files: [], literals: {} };
  }
  return ignoreConfig;
}
function loadIgnoreList() {
  return loadIgnore().files.map((entry) => (typeof entry === "string" ? entry : entry.path));
}
const EMPTY = new Set();
function ignoredLiteralsOf(rel) {
  const list = loadIgnore().literals[rel];
  if (!list) return EMPTY;
  return new Set(list.map((entry) => (typeof entry === "string" ? entry : entry.text)));
}

function fileInScope(filename) {
  if (!filename) return false;
  const file = path.resolve(filename);
  if (!ROOTS.some((root) => file.startsWith(root))) return false;
  if (file.startsWith(I18N_DIR)) return false;
  if (/\.test\.[jt]sx?$/.test(file) || /\.d\.ts$/.test(file)) return false;
  const rel = path.relative(REPO, file).split(path.sep).join("/");
  return !loadIgnoreList().some((entry) => rel === entry || (entry.endsWith("/") && rel.startsWith(entry)));
}

function hasIgnoreComment(node) {
  return (node.leadingComments || []).some((c) => /i18n-ignore\b/.test(c.value));
}

// `/* i18n-ignore */` marks the literal right after it (or its object
// property); `// i18n-ignore-block` before a statement keeps every literal of
// that statement raw — for a whole table of data words.
function ignoredByComment(path) {
  if (hasIgnoreComment(path.node)) return true;
  const parent = path.parentPath;
  if (parent && (parent.isObjectProperty() || parent.isArrayExpression()) && hasIgnoreComment(parent.node)) return true;
  return Boolean(
    path.findParent(
      (p) => (p.isStatement() || p.isObjectProperty()) && (p.node.leadingComments || []).some((c) => /i18n-ignore-block\b/.test(c.value)),
    ),
  );
}

// The exact text React renders for a JSX text child (babel's
// cleanJSXElementLiteralChild): lines are trimmed at their inner edges, blank
// lines dropped, the rest joined with one space. Null when nothing renders.
function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmptyLine = i;
  }
  let str = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;
    let trimmedLine = line.replace(/\t/g, " ");
    if (!isFirstLine) trimmedLine = trimmedLine.replace(/^[ ]+/, "");
    if (!isLastLine) trimmedLine = trimmedLine.replace(/[ ]+$/, "");
    if (trimmedLine) {
      if (!isLastNonEmptyLine) trimmedLine += " ";
      str += trimmedLine;
    }
  }
  return str ? decodeEntities(str) : null;
}

// JSX text keeps HTML entities undecoded in `value`; React renders them decoded.
const ENTITIES = { nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

module.exports = function babunI18nPlugin({ types: t }) {
  const isGenerated = (node) => node && node._i18n === true;
  const mark = (node) => {
    node._i18n = true;
    return node;
  };
  const call = (name, args) => mark(t.callExpression(t.identifier(name), args));
  const literal = (value) => mark(t.stringLiteral(value));

  /**
   * `{ never: reason }` — the literal is not text (a log, a type, a filter on
   * stored data …) and stays exactly as written.
   * `{ logic: reason }` — the literal is a key or is compared: it IS translated,
   * so that both sides of `LOOK[label]` / `label === "…"` speak the same
   * language, and it is listed for review (`check.js --logic`), because when the
   * other side is stored data the right answer is `never`.
   * `null` — plain text.
   */
  function classify(path, text, state) {
    const parent = path.parentPath;
    if (!parent) return null;
    const node = path.node;
    if (ignoredByComment(path)) return { never: "ignore-comment" };
    if (text != null && SMS_TOKEN.test(text)) return { never: "sms-token" };
    if (text != null && state.ignoredLiterals && state.ignoredLiterals.has(text)) return { never: "ignore-list" };
    if (parent.isImportDeclaration() || parent.isExportAllDeclaration() || parent.isExportNamedDeclaration()) return { never: "module" };
    if (parent.isTaggedTemplateExpression()) return { never: "tagged-template" };
    if (parent.isDirective() || parent.isDirectiveLiteral()) return { never: "directive" };
    if (parent.isTSLiteralType() || parent.isTSEnumMember()) return { never: "type" };
    if (path.findParent((p) => p.isTSType() || p.isTSTypeAnnotation() || p.isTSInterfaceDeclaration() || p.isTSTypeAliasDeclaration() || p.isTSEnumDeclaration() || p.isTSModuleDeclaration())) return { never: "type" };
    if (parent.isNewExpression() && t.isIdentifier(parent.node.callee, { name: "RegExp" })) return { never: "regexp" };
    if ((parent.isCallExpression() || parent.isOptionalCallExpression()) && path.listKey === "arguments") {
      const callee = parent.node.callee;
      if (isGenerated(parent.node)) return { never: "generated" };
      if (t.isIdentifier(callee) && (callee.name === "require" || LOG_FUNCTIONS.has(callee.name))) return { never: "log" };
      if (t.isImport(callee)) return { never: "module" };
      if ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && !callee.computed && t.isIdentifier(callee.property)) {
        const method = callee.property.name;
        if (t.isIdentifier(callee.object) && LOG_OBJECTS.has(callee.object.name)) return { never: "log" };
        if (FILTER_METHODS.has(method) && looksLikeQuery(callee.object)) return { never: "query-filter" };
        if (KEY_ARG_METHODS.has(method) && path.key === 0) return { logic: "key-arg:" + method };
      }
    }
    if (path.key === "key" && (parent.isObjectMethod() || parent.isClassProperty() || parent.isClassMethod() || parent.isTSPropertySignature())) return { never: "member-name" };
    if (path.key === "key" && parent.isObjectProperty()) {
      if (parent.parentPath.isObjectPattern()) return { never: "destructuring" };
      return { logic: "object-key" };
    }
    if ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && path.key === "property") return { logic: "member-key" };
    if (parent.isBinaryExpression() && COMPARISON.has(parent.node.operator)) return { logic: "comparison" };
    if (parent.isBinaryExpression({ operator: "in" })) return { logic: "in" };
    if (parent.isSwitchCase() && path.key === "test") return { logic: "case" };
    return null;
  }

  // `.eq(…)` and friends are Supabase filters only on a query chain; on an
  // arbitrary object (`flags.match(…)`) they are not.
  function looksLikeQuery(object) {
    let node = object;
    for (let depth = 0; depth < 12 && node; depth++) {
      if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
        const c = node.callee;
        if ((t.isMemberExpression(c) || t.isOptionalMemberExpression(c)) && t.isIdentifier(c.property)) {
          if (["from", "select", "update", "insert", "upsert", "delete", "rpc"].includes(c.property.name)) return true;
          node = c.object;
          continue;
        }
        return false;
      }
      if (t.isMemberExpression(node)) {
        node = node.object;
        continue;
      }
      if (t.isIdentifier(node)) return /query|q$|builder|req/i.test(node.name);
      return false;
    }
    return false;
  }

  function hasCyrillicTemplate(node) {
    return node.quasis.some((q) => CYRILLIC.test(q.value.cooked ?? q.value.raw));
  }

  /** `a + "x" + b` → [a, "x", b] (only the left spine — that is how JS nests it). */
  function flattenConcat(node) {
    const parts = [];
    let cur = node;
    while (t.isBinaryExpression(cur, { operator: "+" })) {
      parts.unshift(cur.right);
      cur = cur.left;
    }
    parts.unshift(cur);
    return parts;
  }

  function isStringish(node) {
    return t.isStringLiteral(node) || t.isTemplateLiteral(node);
  }

  /** Builds `{pattern, args}` from pieces: strings inline, the rest as {n}. */
  function buildPattern(pieces) {
    let pattern = "";
    const args = [];
    for (const piece of pieces) {
      if (typeof piece === "string") {
        pattern += piece;
      } else {
        pattern += `{${args.length}}`;
        args.push(piece);
      }
    }
    return { pattern, args };
  }

  function templatePieces(node) {
    const pieces = [];
    node.quasis.forEach((q, i) => {
      pieces.push(q.value.cooked ?? q.value.raw);
      if (i < node.expressions.length) pieces.push(node.expressions[i]);
    });
    return pieces;
  }

  /** Wrap a key/value literal in place. Object keys become computed keys. */
  function wrapLiteral(path, node, use) {
    const replacement = call(use(NAMES.t), [literal(node.value !== undefined ? node.value : node.name)]);
    const parent = path.parentPath;
    if (path.key === "key" && parent.isObjectProperty()) {
      parent.node.computed = true;
      parent.node.shorthand = false;
      parent.node.key = replacement;
      return;
    }
    if ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && path.key === "property") {
      parent.node.computed = true;
      parent.node.property = replacement;
      return;
    }
    path.replaceWith(replacement);
  }

  return {
    name: "babun-i18n",
    visitor: {
      Program(programPath, state) {
        const filename = state.filename || state.file.opts.filename;
        if (!state.opts.force && !fileInScope(filename)) return;
        const firstComments = programPath.parent.comments || [];
        if (firstComments.some((c) => /i18n-ignore-file\b/.test(c.value))) return;

        const collect = state.opts.collect || null;
        const rel = path.relative(REPO, path.resolve(filename)).split(path.sep).join("/");
        const ctx = { ignoredLiterals: ignoredLiteralsOf(rel) };
        const used = new Set();
        const record = (kind, key, node, extra) => {
          if (collect) collect({ kind, key, file: rel, line: node && node.loc ? node.loc.start.line : 0, ...extra });
        };
        const use = (name) => {
          used.add(name);
          return name;
        };
        // One decision for every literal-like node: keep it, or wrap it.
        const decide = (path, text, kind) => {
          const verdict = classify(path, text, ctx);
          if (verdict && verdict.never) {
            if (!["generated", "log", "type", "module", "directive"].includes(verdict.never)) {
              record("raw", text, path.node, { reason: verdict.never });
            }
            return false;
          }
          record(verdict && verdict.logic ? "logic" : kind, text, path.node, verdict && verdict.logic ? { reason: verdict.logic } : undefined);
          return true;
        };

        programPath.traverse({
          // ── JSX: a run of text and values inside one element is ONE phrase.
          "JSXElement|JSXFragment"(path) {
            const children = path.node.children;
            if (!children.some((c) => t.isJSXText(c) && CYRILLIC.test(c.value))) return;
            const mergeable =
              children.some((c) => t.isJSXExpressionContainer(c) && !t.isJSXEmptyExpression(c.expression)) &&
              children.every(
                (c) =>
                  t.isJSXText(c) ||
                  (t.isJSXExpressionContainer(c) &&
                    !t.isFunction(c.expression) &&
                    !t.isJSXElement(c.expression) &&
                    !t.isJSXFragment(c.expression)),
              );
            if (!mergeable) return; // single texts are handled by JSXText
            const pieces = [];
            for (const child of children) {
              if (t.isJSXText(child)) {
                const text = cleanJsxText(child.value);
                if (text) pieces.push(text);
              } else if (t.isJSXEmptyExpression(child.expression)) {
                continue;
              } else if (t.isStringLiteral(child.expression)) {
                pieces.push(child.expression.value);
              } else {
                pieces.push(child.expression);
              }
            }
            const { pattern, args } = buildPattern(pieces);
            if (!CYRILLIC.test(pattern)) return;
            if (ctx.ignoredLiterals.has(pattern)) return;
            record("jsx", pattern, path.node, { args: args.length });
            path.node.children = [
              t.jsxExpressionContainer(call(use(NAMES.tj), [literal(pattern), t.arrayExpression(args)])),
            ];
          },

          JSXText(path) {
            if (!CYRILLIC.test(path.node.value)) return;
            const text = cleanJsxText(path.node.value);
            if (!text) return;
            if (SMS_TOKEN.test(text) || ctx.ignoredLiterals.has(text)) {
              record("raw", text, path.node, { reason: "ignore-list" });
              return;
            }
            record("text", text, path.node);
            path.replaceWith(t.jsxExpressionContainer(call(use(NAMES.t), [literal(text)])));
          },

          JSXAttribute(path) {
            const value = path.node.value;
            const name = t.isJSXIdentifier(path.node.name) ? path.node.name.name : "";
            if (!t.isStringLiteral(value)) return;
            if (name === "locale" && RU_TAGS.has(value.value)) {
              path.node.value = t.jsxExpressionContainer(call(use(NAMES.locale), []));
              return;
            }
            if (!CYRILLIC.test(value.value)) return;
            if (RAW_ATTRIBUTES.has(name) || SMS_TOKEN.test(value.value) || ctx.ignoredLiterals.has(value.value)) {
              record("raw", value.value, value, { reason: "attribute:" + name });
              return;
            }
            record("attr", value.value, value, { attr: name });
            path.node.value = t.jsxExpressionContainer(call(use(NAMES.t), [literal(value.value)]));
          },

          // ── `"…" + x + "…"` → one phrase with placeholders.
          BinaryExpression(path) {
            if (path.node.operator !== "+") return;
            if (t.isBinaryExpression(path.parent, { operator: "+" }) && path.key === "left") return;
            const parts = flattenConcat(path.node);
            const first = parts.findIndex(isStringish);
            if (first < 0) return;
            const hasRussian = parts.some(
              (p) => (t.isStringLiteral(p) && CYRILLIC.test(p.value)) || (t.isTemplateLiteral(p) && hasCyrillicTemplate(p)),
            );
            if (!hasRussian) return;
            // Operands before the first string may still be numeric addition:
            // keep that sub-expression whole as the first value.
            const pieces = [];
            if (first > 0) {
              let left = path.node;
              for (let i = parts.length - 1; i >= first; i--) left = left.left;
              pieces.push(left);
            }
            for (let i = first; i < parts.length; i++) {
              const p = parts[i];
              if (t.isStringLiteral(p)) pieces.push(p.value);
              else if (t.isTemplateLiteral(p)) pieces.push(...templatePieces(p));
              else pieces.push(p);
            }
            const { pattern, args } = buildPattern(pieces);
            if (!decide(path, pattern, "concat")) {
              path.skip();
              return;
            }
            path.replaceWith(
              args.length
                ? call(use(NAMES.tf), [literal(pattern), t.arrayExpression(args)])
                : call(use(NAMES.t), [literal(pattern)]),
            );
          },

          TemplateLiteral(path) {
            if (isGenerated(path.node) || !hasCyrillicTemplate(path.node)) return;
            const { pattern, args } = buildPattern(templatePieces(path.node));
            if (!decide(path, pattern, "template")) return;
            path.replaceWith(
              args.length
                ? call(use(NAMES.tf), [literal(pattern), t.arrayExpression(args)])
                : call(use(NAMES.t), [literal(pattern)]),
            );
          },

          // `{ Перенести: … }`, `LOOK.Перенести` — Cyrillic identifiers as keys.
          Identifier(path) {
            const node = path.node;
            if (!CYRILLIC.test(node.name)) return;
            const parent = path.parentPath;
            const isKey = path.key === "key" && parent.isObjectProperty() && !parent.node.computed;
            const isProp = path.key === "property" && (parent.isMemberExpression() || parent.isOptionalMemberExpression()) && !parent.node.computed;
            if (!isKey && !isProp) {
              record("raw", node.name, node, { reason: "identifier" });
              return;
            }
            if (isKey && parent.node.shorthand) {
              record("raw", node.name, node, { reason: "shorthand" });
              return;
            }
            if (!decide(path, node.name, "string")) return;
            wrapLiteral(path, node, use);
          },

          StringLiteral(path) {
            const node = path.node;
            if (isGenerated(node)) return;
            const parent = path.parentPath;
            // Locale tags of date/number formatting follow the UI language.
            if (RU_TAGS.has(node.value) && path.listKey === "arguments" && path.key === 0) {
              const callee = parent.node.callee;
              const prop = callee && (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && t.isIdentifier(callee.property) ? callee.property.name : null;
              if ((parent.isCallExpression() || parent.isOptionalCallExpression()) && prop && LOCALE_METHODS.has(prop)) {
                path.replaceWith(call(use(NAMES.locale), []));
                return;
              }
              if ((parent.isNewExpression() || parent.isCallExpression()) && prop && LOCALE_CTORS.has(prop)) {
                path.replaceWith(call(use(NAMES.locale), []));
                return;
              }
            }
            if (!CYRILLIC.test(node.value)) return;
            // `title="…"` belongs to the JSXAttribute visitor.
            if (parent.isJSXAttribute()) return;
            // `key={"…"}` and friends are identifiers even inside braces.
            if (
              parent.isJSXExpressionContainer() &&
              parent.parentPath.isJSXAttribute() &&
              t.isJSXIdentifier(parent.parent.name) &&
              RAW_ATTRIBUTES.has(parent.parent.name.name)
            ) {
              record("raw", node.value, node, { reason: "attribute:" + parent.parent.name.name });
              return;
            }
            if (!decide(path, node.value, "string")) return;
            wrapLiteral(path, node, use);
          },
        });

        if (used.size === 0) return;
        const exported = { [NAMES.t]: "t", [NAMES.tf]: "tf", [NAMES.tj]: "tj", [NAMES.locale]: "intlLocale" };
        const specifiers = [...used].sort().map((name) =>
          t.importSpecifier(t.identifier(name), t.identifier(exported[name])),
        );
        programPath.unshiftContainer("body", t.importDeclaration(specifiers, t.stringLiteral(RUNTIME_MODULE)));
      },
    },
  };
};

module.exports.fileInScope = fileInScope;
module.exports.cleanJsxText = cleanJsxText;
module.exports.REPO = REPO;
