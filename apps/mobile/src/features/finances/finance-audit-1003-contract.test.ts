import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПОВТОРНЫЙ АУДИТ ФИНАНСОВ 03.10 — сторожа на исходник там, где чистой
// функции нет: экран и формы собирают уже проверенные помощники.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

describe("повторный аудит финансов 03.10", () => {
  test("скрытый счёт — не закрытый: операция на нём правится и удаляется", () => {
    const sheet = read("OperationSheet.tsx");
    assert.match(sheet, /useAccountsWithBalances\(\{ includeHidden: true \}\)/);
    assert.match(sheet, /!a\.is_hidden \|\| a\.id === txOwnAccountId \|\| a\.id === defaultAccountId/);
  });

  test("перевод ищет второй счёт вместе со скрытыми; попап подписывает по всем", () => {
    assert.match(read("FinancesFooter.tsx"), /company: transferAccounts \?\? accounts,/);
    const screen = read("../../../app/(dashboard)/finances/index.tsx");
    assert.match(screen, /transaction=\{popupTx\}[\s\S]{0,200}accounts=\{allAccounts\}/);
  });

  test("«Аналитика» гасит деньги, пока журнал нового периода в пути", () => {
    const analytics = read("analytics/AnalyticsScreen.tsx");
    assert.match(analytics, /const moneyPending = showMoney && \(ledger\.data === undefined \|\| awaitingAnswer\(ledger\)\);/);
    assert.match(analytics, /const ahead = upcomingWork\.owed;/);
  });

  test("пустой разбор дохода не прячет «Работы и оплаты» и «Прогноз»", () => {
    const breakdown = read("ProfitBreakdown.tsx");
    const empty = breakdown.slice(breakdown.indexOf("if (empty) {"), breakdown.indexOf("return (", breakdown.indexOf("if (empty) {") + 40));
    assert.match(empty, /<EmptyState[\s\S]*\{footer\}\s*<\/ScrollView>/);
  });

  test("время новой операции и долга — по часам бизнеса, не телефона", () => {
    const sheet = read("OperationSheet.tsx");
    assert.doesNotMatch(sheet, /formatHM\(new Date\(\)\)/);
    assert.match(sheet, /useState<string \| null>\(\(\) => businessNow\(\)\.hm\)/);
    const debt = read("use-debt-draft.ts");
    assert.doesNotMatch(debt, /formatHM\(new Date\(\)\)/);
    assert.match(debt, /formatHM\(getCurrentTimeInZone\(timeZone\)\)/);
  });

  test("«История платежей» записи сбрасывается с журналом и инвойсами (017)", () => {
    const ledger = read("queries.ts");
    const helper = ledger.slice(ledger.indexOf("export function invalidateLedger"), ledger.indexOf("export function useInsertTransaction"));
    assert.match(helper, /queryKey: \["appointment-ledger"\]/);
    const invoices = read("../invoices/queries.ts");
    const inv = invoices.slice(invoices.indexOf("function invalidateInvoices"), invoices.indexOf("/** ЯЗЫК БУМАГИ"));
    assert.match(inv, /queryKey: \["appointment-ledger"\]/);
  });

  test("отказ «Номер не сохранён» — одно окно, без «Проверьте соединение» (017)", () => {
    const invoices = read("../invoices/queries.ts");
    const hook = invoices.slice(invoices.indexOf("export function useSetInvoiceNextNumber"), invoices.indexOf("mutationFn", invoices.indexOf("export function useSetInvoiceNextNumber")));
    assert.match(hook, /meta: \{ errorHandled: true \}/);
  });

  test("лист перевода не теряет набранное свайпом (017)", () => {
    const sheet = read("TransferSheet.tsx");
    assert.match(sheet, /const guard = useGuardedClose\(\{/);
    assert.equal((sheet.match(/onClose=\{guard\.close\}/g) ?? []).length, 3);
    assert.equal((sheet.match(/onExited=\{guard\.onExited\}/g) ?? []).length, 3);
    assert.doesNotMatch(sheet, /closeUnlessSending/);
  });
});
