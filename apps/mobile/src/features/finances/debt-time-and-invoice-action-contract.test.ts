import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 13.10, нашла сессия 025.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("час долга без часа — по часам бизнеса, а не телефона", () => {
  const sheet = read("DebtSheet.tsx");
  assert.doesNotMatch(sheet, /formatHM\(new Date\(\)\)/);
  assert.match(sheet, /const businessNow = useBusinessNow\(\);/);
});

test("действие из меню списка инвойсов — эффектом, из адреса, и стирается после", () => {
  const page = read("../../../app/invoices/[id].tsx");
  assert.doesNotMatch(page, /pendingAction/);
  const effectAt = page.indexOf("useEffect(() => {\n    if (!pageReady || !action || !runActionRef.current) return;");
  const firstReturn = page.indexOf("  if (loading) {");
  assert.ok(effectAt > 0 && effectAt < firstReturn, "эффект стоит до ранних возвратов");
  // Ссылка на уже открытый инвойс меняет параметр — эффект обязан его слышать.
  assert.match(page, /\}, \[pageReady, action, router\]\);/);
  assert.match(page, /router\.setParams\(\{ action: undefined \}\);/);
  assert.match(page, /runActionRef\.current = \(next\) => \{/);
  assert.ok(page.indexOf("runActionRef.current = (next)") > page.indexOf("const docWrite ="));
  // Одна печать за раз.
  assert.match(page, /if \(!invoice\.data \|\| !settlement \|\| pdfRunning\.current\) return;/);
});
