import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// КОРЕНЬ «ЗАСТЫВАНИЙ» (владелец 11.10): вопрос из открытого листа больше не
// второе окно поверх первого — он ложится в окно листа. Проверено в вебе:
// вопрос из листа виден внутри него, «Удалить» и «Отмена» доходят.

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("лист держит место для накладки и встаёт в стопку, пока открыт", () => {
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /<SheetOverlayOutlet id=\{sheetId\} \/>/);
  assert.match(sheet, /pushSheet\(sheetId\);/);
  // Закрывающийся лист из стопки уходит сразу: в уезжающее окно не ложатся.
  assert.match(sheet, /if \(asOverlay \|\| !mounted \|\| !visible\) \{\s*removeSheet\(sheetId\);/);
  // Лист под накладкой пропал — накладка закрывается, а не висит без окна.
  assert.match(sheet, /if \(!isSheetOpen\(host\)\) closeRef\.current\(\);/);
});

test("лист выбора и вопроса ложится поверх открытого листа", () => {
  assert.match(read("ChoiceSheet.tsx"), /overlayIfStacked\s/);
});

test("накладка будит только своё место, а не все листы (иначе круг)", () => {
  const src = read("sheet-overlay.tsx");
  assert.match(src, /export function setOverlay[\s\S]{0,120}emitOverlay\(\);/);
  assert.doesNotMatch(src.slice(src.indexOf("export function setOverlay"), src.indexOf("/** Подписка на перемены стопки")), /\bemit\(\);/);
});
