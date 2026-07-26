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

describe("ловушки nativewind", () => {
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
