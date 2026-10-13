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

test("тап мимо листа закрывает его и с рамкой подъёма над клавиатурой", () => {
  // Рамка подъёма во весь экран лежит ПОВЕРХ затемнения (сосед, не предок):
  // без `box-none` она съедала тап, и на Android ни один лист не закрывался
  // тапом мимо (12.10, подъём у каждого листа).
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /<KeyboardLift\s+pointerEvents="box-none"/);
  const lift = read("KeyboardLift.tsx");
  assert.match(lift, /<KeyboardAvoidingView[\s\S]{0,80}pointerEvents=\{pointerEvents\}/);
  assert.match(lift, /<View ref=\{ref\} pointerEvents=\{pointerEvents\}/);
});

test("лист без футера на Android держит отступ навигации снизу", () => {
  // Окно листа edge-to-edge: без отступа последняя строка выбора ложилась под
  // «Назад / Домой» трёхкнопочной навигации, где её не нажать (13.10).
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /\) : Platform\.OS === "android" && !keyboardShown \? \(/);
  assert.match(sheet, /<View style=\{\{ height: insets\.bottom \}\} \/>/);
});

test("уезжающий лист не тянется, отклонённый свайп возвращает лист", () => {
  // Второй рывок во время выхода срывал анимацию — лист оставался
  // смонтированным невидимкой со скримом, глотавшим каждый тап (13.10).
  const sheet = read("BottomSheet.tsx");
  assert.match(sheet, /const drag = Gesture\.Pan\(\)[\s\S]{0,700}\.enabled\(visible\)/);
  assert.match(sheet, /runOnJS\(closeFromDrag\)\(\);/);
  assert.match(sheet, /if \(!visibleRef\.current\) return;\s*ty\.value = withSpring\(0/);
});
