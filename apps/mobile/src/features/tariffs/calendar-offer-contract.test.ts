import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ПРЕДЛОЖЕНИЕ «НОВЫЙ КАЛЕНДАРЬ» (13.10). Лист тянет react-native — проверка по
// исходнику.
const src = readFileSync(join(__dirname, "CalendarOfferSheet.tsx"), "utf8");

test("лист создания открывается, когда предложение уехало, а не поверх него", () => {
  // Второе окно, открытое при уезжающем первом, iOS не показывает.
  assert.doesNotMatch(src, /onClose\(\);\s*onUnlocked\(\);/);
  assert.match(src, /afterExit\.current = onUnlocked;/);
  assert.match(src, /onExited=\{\(\) => \{\s*const run = afterExit\.current;/);
});

test("оплата при живой подписке не закрывается молча", () => {
  const pay = src.slice(src.indexOf("const pay = async"), src.indexOf("const action ="));
  assert.match(pay, /const result = await openTariffCheckout\(/);
  assert.match(pay, /result === "changed"/);
  assert.match(pay, /invalidateQueries\(\{ queryKey: \["tenant"\] \}\)/);
});
