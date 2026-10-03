import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { transformSync, type PluginItem } from "@babel/core";

// The plugin is plain CommonJS so babel.config.js can load it without a build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("./babel-plugin") as PluginItem;

type Entry = { kind: string; key: string; reason?: string };

const has = (code: string, text: string) => assert.ok(code.includes(text), `expected: ${text}\n---\n${code}`);
const lacks = (code: string, text: string) => assert.ok(!code.includes(text), `unexpected: ${text}\n---\n${code}`);

/** Runs the plugin on a snippet as if it lived in app source. */
function run(code: string, file = "apps/mobile/src/features/demo/Demo.tsx") {
  const entries: Entry[] = [];
  const out = transformSync(code, {
    filename: path.resolve(__dirname, "../../../..", file),
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    generatorOpts: { jsescOption: { minimal: true } },
    plugins: [[plugin, { collect: (e: Entry) => entries.push(e) }]],
  });
  return { code: out?.code ?? "", entries };
}

describe("i18n babel plugin", () => {
  it("wraps JSX text, attributes and plain strings", () => {
    const { code } = run(`
      const A = () => <Text title="Клиент">Кабинет</Text>;
      const label = "Применить";
    `);
    has(code, `title={__i18n_t("Клиент")}`);
    has(code, `{__i18n_t("Кабинет")}`);
    has(code, `const label = __i18n_t("Применить")`);
    has(code, `from "@babun/shared/i18n/runtime"`);
  });

  it("turns templates and concatenation into one phrase with slots", () => {
    const { code } = run("const a = `Удалить «${name}»?`; const b = \"Удалить \" + name + \"?\"; const c = n + 1 + \" записей\";");
    has(code, `__i18n_tf("Удалить «{0}»?", [name])`);
    has(code, `__i18n_tf("Удалить {0}?", [name])`);
    // Numeric addition before the first string stays one value.
    has(code, `__i18n_tf("{0} записей", [n + 1])`);
  });

  it("keeps text and values of one element as one phrase", () => {
    const { code } = run(`const A = () => <Text>Всего {n} записей</Text>;`);
    has(code, `{__i18n_tj("Всего {0} записей", [n])}`);
  });

  it("does not merge across nested elements — fragments keep their spaces", () => {
    const { code } = run(`const A = () => <Text>Нажмите <B>здесь</B> чтобы</Text>;`);
    has(code, `__i18n_t("Нажмите ")`);
    has(code, `__i18n_t(" чтобы")`);
  });

  it("translates both sides of keys and comparisons, and reports them", () => {
    const { code, entries } = run(`
      const LOOK = { "Свободное перемещение": 1, Перенести: 2 };
      const x = LOOK.Перенести;
      if (label === "Отмена") go();
    `);
    has(code, `[__i18n_t("Свободное перемещение")]: 1`);
    has(code, `[__i18n_t("Перенести")]: 2`);
    has(code, `LOOK[__i18n_t("Перенести")]`);
    has(code, `label === __i18n_t("Отмена")`);
    assert.deepEqual(entries.filter((e) => e.kind === "logic").map((e) => e.reason), [
      "object-key",
      "object-key",
      "member-key",
      "comparison",
    ]);
  });

  it("leaves logs, regexps, SMS tokens, query filters and types alone", () => {
    const { code } = run(`
      type Status = "Оплачено";
      console.log("лог");
      const re = new RegExp("вчера");
      const token = "[Имя]";
      const q = supabase.from("t").select("*").eq("name", "Материалы");
      const A = () => <View key="Ключ" />;
      const kept = /* i18n-ignore */ "Как есть";
      // i18n-ignore-block
      const ALIASES = { Имя: "Name" };
    `);
    has(code, `Имя: "Name"`);
    for (const raw of [`"Оплачено"`, `console.log("лог")`, `new RegExp("вчера")`, `"[Имя]"`, `.eq("name", "Материалы")`, `key="Ключ"`, `"Как есть"`]) {
      has(code, raw);
    }
    // A substring check alone would also pass on __i18n_t("[Имя]").
    for (const text of ["Оплачено", "лог", "вчера", "[Имя]", "Материалы", "Ключ", "Как есть"]) {
      lacks(code, `__i18n_t(${JSON.stringify(text)})`);
    }
  });

  it("points Russian date and number formatting at the UI language", () => {
    const { code } = run(`
      const a = d.toLocaleDateString("ru-RU", { day: "numeric" });
      const b = new Intl.DateTimeFormat("ru-RU").format(d);
      const sort = new Intl.Collator("ru");
      const P = () => <Picker locale="ru-RU" />;
    `);
    has(code, `d.toLocaleDateString(__i18n_locale(), {`);
    has(code, `new Intl.DateTimeFormat(__i18n_locale())`);
    has(code, `new Intl.Collator("ru")`);
    has(code, `locale={__i18n_locale()}`);
  });

  it("touches only app source — not tests, not files outside the app", () => {
    lacks(run(`const a = "Клиент";`, "apps/mobile/src/features/demo/demo.test.ts").code, "__i18n");
    lacks(run(`const a = "Клиент";`, "supabase/functions/x/index.ts").code, "__i18n");
    lacks(run(`// i18n-ignore-file\nconst a = "Клиент";`).code, "__i18n");
  });
});
