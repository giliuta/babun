import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ШКАЛА ТЕКСТА ОДНА НА ПРОДУКТ (DS §2, `ui/tokens.ts` → TYPE).
//
// Вся CRM — в едином стиле, шрифте и количестве пикселей: что сделано в
// календаре, то же самое в финансах и клиентах.
//
// Шкала была записана в документе и не соблюдалась: в коде жило ЧЕТЫРНАДЦАТЬ
// кеглей в шестистах местах. Тест держит СЛОЙ ПРИМИТИВОВ — через него рисуются
// все экраны продукта, поэтому он даёт больше всего единообразия за раз и
// дальше не даёт долгу вернуться.
//
// ДОЛГ ОСТАЛЬНЫХ СЛОЁВ (`src/features`, `app`) здесь числом не записан —
// число устаревает за день; его печатает греп
// `grep -rnE "fontSize: *[0-9]+|text-(xs|sm|base|lg|xl)" src/features app`.
// Слои переводятся волнами по доменам; когда слой чист — он добавляется сюда.
// Расширять область раньше времени нельзя: тест либо зелёный, либо его
// выключают, а выключенный тест не держит ничего.

const ALLOWED = new Set([11, 13, 15, 17, 26, 28, 34]);

/** Кегль класса Tailwind — тот же долг, только мимо `fontSize:`: `text-sm`
 *  (14) и `text-base` (16) сторож раньше не видел вовсе. */
const CLASS_SIZE: Record<string, number> = {
  "text-xs": 12,
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
  "text-3xl": 30,
};

/** Сетка календаря и подписи часов живут своей вебовской арифметикой и в
 *  шкалу не входят — это единственное законное исключение (DS §2). */
const EXEMPT: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith(".tsx")
        ? [full]
        : [];
  });
}

describe("шкала текста", () => {
  test("примитивы не изобретают своих кеглей", () => {
    const root = join(__dirname, "..", "components", "ui");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (EXEMPT.some((e) => file.endsWith(e))) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/fontSize:\s*(\d+)/g)) {
        const size = Number(m[1]);
        if (ALLOWED.has(size)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(
          `${file.split("/components/")[1]}:${line} — кегль ${size} вне шкалы TYPE`,
        );
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("примитивы не берут кегль классом вне шкалы", () => {
    const root = join(__dirname, "..", "components", "ui");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (EXEMPT.some((e) => file.endsWith(e))) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/className=\{?["`]([^"`]*)["`]/g)) {
        for (const cls of m[1].split(/\s+/)) {
          const px = /^text-\[(\d+)px\]$/.exec(cls);
          const size = px ? Number(px[1]) : CLASS_SIZE[cls];
          if (size === undefined || ALLOWED.has(size)) continue;
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(
            `${file.split("/components/")[1]}:${line} — класс ${cls} (${size}) вне шкалы TYPE`,
          );
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
