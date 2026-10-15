import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("час долга без часа — по часам бизнеса, а не телефона", () => {
  // Вход листа + его части в `debt-sheet/`.
  const sheet = readModuleSource(resolve(here, "DebtSheet.tsx"), resolve(here, "debt-sheet"));
  assert.doesNotMatch(sheet, /formatHM\(new Date\(\)\)/);
  assert.match(sheet, /const businessNow = useBusinessNow\(\);/);
});

test("действие из меню списка инвойсов — эффектом, из адреса, и стирается после", () => {
  // Маршрут — тонкий вход; страница живёт в `features/invoices/detail/`.
  const page = read("../invoices/detail/InvoiceDetailScreen.tsx");
  const detail = readModuleSource(resolve(here, "../invoices/detail/InvoiceDetailScreen.tsx"), resolve(here, "../invoices/detail"));
  assert.doesNotMatch(detail, /pendingAction/);
  const effectAt = page.indexOf("useEffect(() => {\n    if (!pageReady || !action || !runActionRef.current) return;");
  const firstReturn = page.indexOf("  if (loading) {");
  assert.ok(effectAt > 0 && effectAt < firstReturn, "эффект стоит до ранних возвратов");
  // Ссылка на уже открытый инвойс меняет параметр — эффект обязан его слышать.
  assert.match(page, /\}, \[pageReady, action, router\]\);/);
  assert.match(page, /router\.setParams\(\{ action: undefined \}\);/);
  assert.match(page, /runActionRef\.current = \(next\) => \{/);
  assert.ok(page.indexOf("runActionRef.current = (next)") > page.indexOf("const docWrite ="));
  // Одна печать за раз (действия PDF живут в хуке страницы).
  assert.match(detail, /if \(!invoice\.data \|\| !settlement \|\| pdfRunning\.current\) return;/);
});
