import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛОВУШКИ NATIVEWIND, которые роняют экран красной ошибкой.
//
// react-native-css объявляет для некоторых компонентов nativeStyleMapping со
// значением `true` (TextInput → { textAlign: true }, ImageBackground →
// { backgroundColor: true }), а сама же делает `path.split(".")`. На `true`
// это падает: «path.split is not a function».
//
// Срабатывает, когда соответствующее свойство приходит ИЗ КЛАССА. Один
// `text-right` на поле цены услуги ронял весь экран заявки — и добраться до
// него можно было из истории визитов клиента.
//
// Значит: у TextInput выравнивание задаём СТИЛЕМ, у ImageBackground фон —
// тоже стилем. Тест держит это правило на весь проект.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const TRAPS: { tag: string; danger: RegExp; hint: string }[] = [
  {
    tag: "TextInput",
    danger: /\btext-(right|center|left|justify)\b/,
    hint: 'выравнивание задавайте style={{ textAlign: … }}',
  },
  {
    tag: "ImageBackground",
    danger: /\bbg-\S+/,
    hint: 'фон задавайте style={{ backgroundColor: … }}',
  },
];

// `tabular-nums` В КЛАССЕ — МОЛЧАЛИВАЯ ПУСТЫШКА.
//
// react-native-css реализует из font-variant только `font-variant-caps`;
// font-variant-numeric в пакете отсутствует, поэтому
// `className="tabular-nums"` не доходит до текста ВООБЩЕ. Цифры в колонке
// остатков гуляют по ширине при каждом рефетче, и на скриншоте это не
// видно — только глазом на живом списке. Работает ровно одно:
// `style={{ fontVariant: ["tabular-nums"] }}`.
//
// TODO: снять ограничение области и распространить правило на весь
// apps/mobile — в продукте ещё 85 таких классов в 32 файлах (финансы,
// клиенты, календарь, склад). Они правятся общей уборкой отдельной
// задачей; пока правило держит только экраны счетов, где деньги
// пересчитываются чаще всего.
const TABULAR_SCOPE = [
  "app/accounts",
  "src/features/finances/AccountCreateSheet.tsx",
  "src/features/finances/TransferSheet.tsx",
];

/** Классы всех `className` файла вместе с номером строки. */
function classNamesOf(src: string): { cls: string; line: number }[] {
  const out: { cls: string; line: number }[] = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    out.push({
      cls: m[1] ?? m[2] ?? "",
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

describe("ловушки nativewind", () => {
  test("деньги счетов держат tabular-nums стилем, а не классом", () => {
    const offenders: string[] = [];
    for (const rel of TABULAR_SCOPE) {
      const full = join(root, rel);
      const files = statSync(full).isDirectory() ? walk(full) : [full];
      for (const file of files) {
        for (const { cls, line } of classNamesOf(readFileSync(file, "utf8"))) {
          if (/\btabular-nums\b/.test(cls)) {
            offenders.push(
              `${file.replace(root + "/", "")}:${line} — класс "tabular-nums" ` +
                'ничего не делает; перенесите в style={{ fontVariant: ["tabular-nums"] }}',
            );
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("textAlign и backgroundColor не приходят из класса", () => {
    const offenders: string[] = [];
    for (const file of [...walk(join(root, "src")), ...walk(join(root, "app"))]) {
      const src = readFileSync(file, "utf8");
      for (const { tag, danger, hint } of TRAPS) {
        const re = new RegExp(`<${tag}\\b[\\s\\S]{0,2000}?/>`, "g");
        for (const m of src.matchAll(re)) {
          const cn = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[0]);
          const cls = cn?.[1] ?? cn?.[2] ?? "";
          if (cls && danger.test(cls)) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(
              `${file.replace(root + "/", "")}:${line} <${tag}> — ${hint}`,
            );
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
