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

test("«Тариф» считает календари аккаунта страницы, а не открытого в календаре", () => {
  const screen = readFileSync(join(__dirname, "TariffScreen.tsx"), "utf8");
  assert.match(screen, /const calendars = Math\.max\(1, liveCount \?\?/);
  const hook = readFileSync(join(__dirname, "use-live-calendars.ts"), "utf8");
  assert.match(hook, /const scope = useAccountScope\(\);/);
  assert.match(hook, /scope\.client\s*\.from\("teams"\)/);
  assert.match(hook, /queryKey: \["teams", "live-count", scope\.tenantId/);
});
