import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ШКАЛА ТЕКСТА ОДНА НА ПРОДУКТ (DS §2, `ui/tokens.ts` → TYPE).
//
// Владелец 2026-09-10: «хотелось бы, чтобы вся CRM была в едином стиле, в
// едином шрифте, в единых количествах пикселей… если в календаре я сделаю
// что-то, то и в финансах, и в клиентах должно быть точно так же».
//
// Шкала была записана в документе и не соблюдалась: в коде жило ЧЕТЫРНАДЦАТЬ
// кеглей в шестистах местах. Тест держит СЛОЙ ПРИМИТИВОВ — через него рисуются
// все экраны продукта, поэтому он даёт больше всего единообразия за раз и
// дальше не даёт долгу вернуться.
//
// ДОЛГ ОСТАЛЬНЫХ СЛОЁВ (2026-09-10): 87 мест в `src/features`, 101 в `app`.
// Они переводятся волнами по доменам; когда слой чист — он добавляется сюда.
// Расширять область раньше времени нельзя: тест либо зелёный, либо его
// выключают, а выключенный тест не держит ничего.

const ALLOWED = new Set([11, 13, 15, 17, 26, 28, 34]);

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
});
