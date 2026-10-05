import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// СЛОТ → «КЛИЕНТ» → /book: ФОРМА ОТКРЫВАЕТСЯ ПОСЛЕ УХОДА ЛИСТА (04.10).
//
// Блокер проверки App Store: тап по свободному времени, в листе «Client», и
// форма новой записи открывалась мёртвой — ни один тап, даже «Отмена». На
// iPhone 17 Pro Max воспроизведено: /book сразу поднимает шторку клиента, а
// лист слота — отдельное окно `Modal`, которое в этот момент ещё уезжает. Два
// окна в один кадр iOS не показывает: шторка оставалась невидимой поверх
// формы и съедала касания. Проверяющий Apple пойдёт именно этой дорогой.
//
// Сторож смотрит в исходник: правило — порядок вызовов, у него нет чистой
// функции, которую можно спросить.

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "BookSlotSheet.tsx"), "utf8");

describe("лист слота уступает окно форме записи", () => {
  test("выбор дороги закрывает лист, а /book открывается по onExited", () => {
    const pick = sheet.slice(
      sheet.indexOf("const pick = (kind"),
      sheet.indexOf("const voSuffix"),
    );
    assert.ok(pick.length > 0, "не найден обработчик выбора дороги");
    assert.doesNotMatch(
      pick,
      /\n\s*onPick\(kind, draft\);/,
      "выбор снова зовёт onPick сразу — /book поднимет шторку поверх уходящего листа",
    );
    assert.match(pick, /afterExit\.current = \(\) => onPick\(kind, chosen\);/);
    assert.match(pick, /onClose\(\);/);
    assert.match(
      sheet,
      /onExited=\{\(\) => \{[\s\S]{0,120}?afterExit\.current[\s\S]{0,80}?run\?\.\(\);/,
      "отложенный переход больше не запускается по уходу листа",
    );
  });

  test("никаких таймеров вместо ухода окна", () => {
    // Таймер мерит анимацию, а не снятие окна (BottomSheet.onExited).
    assert.ok(!sheet.includes("setTimeout"), "в листе слота появился таймер");
  });
});
