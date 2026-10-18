import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// КОЛОНКА «МЕСЯЦ» ВЕБ-БАРАБАНА ДАТЫ ВМЕЩАЕТ САМОЕ ДЛИННОЕ НАЗВАНИЕ НА ЛЮБОМ
// ЯЗЫКЕ. Ширина подбиралась по-русски («сентября»), а греческое
// «Σεπτεμβρίου» и «Φεβρουαρίου» в неё не влезали — месяц обрезался.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const LANGS = ["en", "bg", "el", "uk", "de", "es"];
/** Средняя ширина знака активной строки (22px, полужирный) с запасом. */
const GLYPH_PX = 13;

test("ширины колонки «Месяц» хватает самому длинному переводу", () => {
  const source = read("DateSpinner.web.tsx");
  const match = source.match(/label="Месяц"[\s\S]{0,240}?width=\{(\d+)\}/);
  assert.ok(match, "не нашлась ширина колонки «Месяц»");
  const width = Number(match[1]);

  let longest = Math.max(...MONTHS.map((m) => m.length));
  for (const lang of LANGS) {
    const dict = JSON.parse(
      read(`../../../../../packages/shared/src/i18n/dict/${lang}.json`),
    ) as Record<string, string>;
    for (const month of MONTHS) longest = Math.max(longest, (dict[month] ?? month).length);
  }
  assert.ok(
    width >= longest * GLYPH_PX,
    `колонка ${width}px, а самому длинному месяцу (${longest} знаков) нужно ${longest * GLYPH_PX}px`,
  );
});
