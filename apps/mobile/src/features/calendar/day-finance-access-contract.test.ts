import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ДЕНЬГИ В КАЛЕНДАРЕ — ПРАВОМ КАЛЕНДАРЯ «ДОХОД И РАСХОД ДНЯ» (владелец 04.10:
// «функция расход/доход должна быть в доступах календаря — не общие
// финансы»). Старые «ручные операции дня» сервер по-прежнему правит по
// сторонам «Финансов» (срез 2а, 29.09). Экраны тянут react-native и под раннером не поднимаются, поэтому
// проверка — по исходнику: верни проверку роли, общий ключ или убери серое
// «Смотрит» — и сотрудник либо не увидит свои деньги, либо увидит кнопку,
// которую сервер откажет.

const normalize = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

const read = (rel: string) => normalize(readFileSync(join(__dirname, rel), "utf8"));

/** Кусок кода стоит в файле ровно один раз (пробелы схлопнуты). */
function has(text: string, fragment: string, label: string, times = 1): void {
  const needle = normalize(fragment).trim();
  assert.equal(text.split(needle).length - 1, times, `${label}: ${needle}`);
}

describe("шторка «Финансы дня»", () => {
  const sheet = read("DayFinanceSheet.tsx");

  test("уровень — право календаря «Доход и расход дня» в ЭТОМ календаре (04.10)", () => {
    has(
      sheet,
      `const canWriteDayMoney = dayMoneyGate({ role, map: myAccess, teamId }) === "write";
       const canWriteIncome = canWriteDayMoney;
       const canWriteExpense = canWriteDayMoney;`,
      "гейт по праву календаря",
    );
    assert.doesNotMatch(sheet, /blockKey: "finance\.operations"/);
  });

  test("строки дня — его правом календаря (в зеркале токен владельца)", () => {
    has(
      sheet,
      `const readable = dayMoneyRowReadable({ role, map: myAccess, today: businessToday });`,
      "фильтр строк",
    );
  });

  test("операция из листа помечена «из календаря»", () => {
    has(sheet, `transaction={editingTx} fromCalendar />`, "признак");
  });

  test("«Смотрит»: кнопка на месте, серая, с причиной — по стороне плитки", () => {
    has(sheet, `<GradientButton label={cta.label} onPress={cta.onPress} disabled={!cta.open} />`, "кнопка");
    assert.match(sheet, /\{cta\.open \? null : \( <Text[^>]*> Только просмотр <\/Text> \)\}/);
    has(sheet, `{ label: "Добавить доход", onPress: () => openOperation(null, "income"), open: canWriteIncome }`, "доход");
    has(sheet, `{ label: "Добавить расход", onPress: () => openOperation(null, "expense"), open: canWriteExpense }`, "расход");
    has(sheet, `open: canWriteIncome || canWriteExpense`, "общая операция");
  });

  test("правка операции — ровно то, что пустит сервер; удаление старой ручной строки — по её стороне", () => {
    has(
      sheet,
      `canEditTransaction(tx) &&
       (role === "owner" || !tx.debt_id) &&
       canEditDayMoneyRow({
         role,
         map: myAccess,
         teamId: tx.team_id ?? teamId,
         createdBy: tx.created_by,
         me,
         fromCalendar: tx.from_calendar,
       })`,
      "правка операции",
    );
    has(
      sheet,
      `return teamId && writesLegacySide(e.kind) ? ( <SwipeRow key={e.id} label="Удалить"`,
      "свайп",
    );
    assert.match(sheet, /onAction=\{\(\) => askRemoveLegacy\(e\)\}/);
  });
});

describe("ручные операции дня", () => {
  const queries = read("queries.ts");

  test("читаются, если видна хоть одна сторона, а не только владельцу", () => {
    has(
      queries,
      `const sees = (["income", "expense"] as const).some((side) => {
         const gate = accessGate({ role, map, blockKey: moneyKey(map, side), scope: "calendar" });
         return gate === "read" || gate === "write";
       });`,
      "чтение",
    );
    has(queries, `enabled: !!tenantId && roleQuery.isSuccess && sees,`, "enabled");
    assert.doesNotMatch(queries, /role === "owner",/);
  });

  test("меняются, если он пишет хоть одну сторону в этом календаре", () => {
    has(
      queries,
      `const writes = (["income", "expense"] as const).some(
         (side) =>
           accessGate({ role, map: myAccess, blockKey: moneyKey(myAccess, side), scope: "calendar", teamId }) ===
           "write",
       );
       if (!writes) {`,
      "запись",
    );
    assert.doesNotMatch(queries, /blockKey: "finance\.operations"/);
  });
});

describe("полоса денег под календарём", () => {
  const home = read("../../../app/(dashboard)/(home)/index.tsx");

  test("видна по праву календаря «Доход и расход дня», а не по роли и не по «Финансам»", () => {
    has(
      home,
      `const seesDayMoneyHere = seesDayMoney(
         dayMoneyGate({ role, map: myAccessQuery.data, teamId: activeTeamId }),
       );
       const seesIncome = seesDayMoneyHere;
       const seesExpense = seesDayMoneyHere;
       const canViewCompanyFinance = seesDayMoneyHere;`,
      "право календаря",
    );
    assert.doesNotMatch(home, /moneyKey\(/);
    assert.doesNotMatch(home, /const canViewCompanyFinance = role === "owner";/);
    assert.doesNotMatch(home, /blockKey: "finance\.operations"/);
  });

  test("строка невидимой стороны не рисуется; месяц с прибылью — только при обеих", () => {
    has(home, `showIncome={seesIncome} showExpense={seesExpense}`, "полоса недели и дня", 2);
    has(home, `showFinance={seesIncome && seesExpense}`, "месяц");
  });
});
