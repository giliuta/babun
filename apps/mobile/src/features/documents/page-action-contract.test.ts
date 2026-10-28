import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ДЕЙСТВИЕ ИЗ МЕНЮ СПИСКА (`?action=`) — ОДНО ПРАВИЛО НА ИНВОЙС И ЧЕК, И СЧЁТ
// ОПЛАТЫ В ЧЕКЕ БЕРЁТСЯ ИЗ ПРОВОДКИ.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("usePageAction", () => {
  const hook = read("../../lib/use-page-action.ts");

  test("эффект ждёт готовности страницы и стирает параметр", () => {
    assert.match(hook, /if \(!ready \|\| !action \|\| !runRef\.current\) return;/);
    assert.match(hook, /router\.setParams\(\{ action: undefined \}\);/);
  });

  test("таймер снимается только уходом со страницы, действие берётся из ref в миг срабатывания", () => {
    assert.match(hook, /useEffect\(\s*\(\) => \(\) => \{\s*if \(timer\.current\) clearTimeout\(timer\.current\);\s*\},\s*\[\],\s*\);/);
    assert.match(hook, /setTimeout\(\(\) => runRef\.current\?\.\(next\), ACTION_DELAY_MS\)/);
    // Внутри эффекта поиска действия таймер не снимается: стирание параметра само его перезапускает.
    const effect = hook.slice(hook.indexOf("useEffect(() => {"));
    assert.doesNotMatch(effect, /clearTimeout/);
  });
});

describe("страница чека", () => {
  const page = read("ReceiptPage.tsx");

  test("действие — через usePageAction, а не таймером в теле рендера", () => {
    assert.match(page, /usePageAction\(action, !!receipt && !!paper\.doc && !paper\.linesLoading\)/);
    assert.doesNotMatch(page, /pendingAction/);
    assert.doesNotMatch(page, /setTimeout/);
    assert.match(page, /runActionRef\.current = \(next\) => \{\s*if \(next === "share" && docWrite\) void sharePdf\(\);/);
  });
});

describe("страница инвойса", () => {
  const detail = readModuleSource(
    resolve(here, "../invoices/detail/InvoiceDetailScreen.tsx"),
    resolve(here, "../invoices/detail"),
  );

  test("тот же хук; «чек» не ждёт вечно упавший запрос чеков", () => {
    assert.match(detail, /usePageAction\(action, pageReady\)/);
    assert.match(detail, /const receiptsSettled = receiptsQuery\.isSuccess \|\| receiptsQuery\.isError;/);
    assert.match(detail, /\(action !== "receipt" \|\| receiptsSettled\)/);
    // Остальные действия готовность чеков не ждут.
    assert.doesNotMatch(detail, /const pageReady =[^;]*receiptsQuery\.isSuccess\s*;/);
  });

  test("ссылка «чек» при упавшем запросе говорит об этом, а не молчит", () => {
    assert.match(detail, /notify\("Не удалось проверить чеки"/);
  });
});

describe("счёт чека на оплату", () => {
  test("составитель берёт счёт проводки и среди скрытых и закрытых", () => {
    const composer = read("ReceiptComposer.tsx");
    assert.match(
      composer,
      /useAccountsWithBalances\(\{\s*includeInactive: true,\s*includeHidden: true,\s*includeDeleted: true,\s*\}\)/,
    );
    assert.match(composer, /\.filter\(\(a\) => a\.id === draft\.accountId\)/);
  });

  test("чека с нуля нет: ни «Выберите счёт», ни прихода из составителя", () => {
    const page = readFileSync(resolve(here, "../../../app/documents/receipt-new.tsx"), "utf8");
    assert.doesNotMatch(page, /Выберите счёт|useComposeReceipt|forPayment/);
    assert.match(page, /if \(!params\.transactionId && !params\.receiptId\) \{/);
  });
});
