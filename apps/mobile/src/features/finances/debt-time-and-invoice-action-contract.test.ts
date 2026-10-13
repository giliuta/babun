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

test("действие из меню списка инвойсов — эффектом, а не в теле отрисовки", () => {
  const page = read("../../../app/invoices/[id].tsx");
  assert.doesNotMatch(page, /if \(pendingAction\.current && receiptsQuery\.isSuccess\)/);
  const effectAt = page.indexOf("useEffect(() => {\n    if (!pageReady || !pendingAction.current");
  const firstReturn = page.indexOf("  if (loading) {");
  assert.ok(effectAt > 0 && effectAt < firstReturn, "эффект стоит до ранних возвратов");
  assert.match(page, /runActionRef\.current = \(next\) => \{/);
  assert.ok(page.indexOf("runActionRef.current = (next)") > page.indexOf("const docWrite ="));
});
