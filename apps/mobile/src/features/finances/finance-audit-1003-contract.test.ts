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
});
