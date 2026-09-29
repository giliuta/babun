import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ДЕНЬГИ В КАЛЕНДАРЕ — ПО СТОРОНАМ ДЕНЕГ (этап 2, владелец 15.09: «чтоб всё
// сразу менялось в живом времени»; срез 2а, 29.09: доходы и расходы — два
// права). Экраны тянут react-native и под раннером не поднимаются, поэтому
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

  test("уровень — своя сторона денег в ЭТОМ календаре, общего ключа нет", () => {
    has(
      sheet,
      `const writesSide = (side: "income" | "expense") =>
         accessGate({ role, map: myAccess, blockKey: moneyKey(myAccess, side), scope: "calendar", teamId }) === "write";
       const canWriteIncome = writesSide("income");
       const canWriteExpense = writesSide("expense");`,
      "гейт по стороне",
    );
    assert.doesNotMatch(sheet, /blockKey: "finance\.operations"/);
  });

  test("«Смотрит»: кнопка на месте, серая, с причиной — по стороне плитки", () => {
    has(sheet, `<GradientButton label={cta.label} onPress={cta.onPress} disabled={!cta.open} />`, "кнопка");
    assert.match(sheet, /\{cta\.open \? null : \( <Text[^>]*> Только просмотр <\/Text> \)\}/);
    has(sheet, `{ label: "Добавить доход", onPress: () => openOperation(null, "income"), open: canWriteIncome }`, "доход");
    has(sheet, `{ label: "Добавить расход", onPress: () => openOperation(null, "expense"), open: canWriteExpense }`, "расход");
    has(sheet, `open: canWriteIncome || canWriteExpense`, "общая операция");
  });

  test("правка операции — ровно то, что пустит сервер; удаление ручной строки — по её стороне", () => {
    has(
      sheet,
      `canEditTransaction(tx) &&
       (role === "owner" || !tx.debt_id) &&
       canEditMoneyRow({ role, map: myAccess, teamId: tx.team_id ?? teamId, side, createdBy: tx.created_by, me })`,
      "правка операции",
    );
    has(
      sheet,
      `return teamId && (e.kind === "income" ? canWriteIncome : canWriteExpense) ? ( <SwipeRow key={e.id} label="Удалить"`,
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

  test("видна по сторонам активного календаря, а не по роли", () => {
    has(
      home,
      `const seesSide = (side: "income" | "expense") => {
         const gate = accessGate({
           role,
           map: myAccessQuery.data,
           blockKey: moneyKey(myAccessQuery.data, side),
           scope: "calendar",
           teamId: activeTeamId,
         });
         return gate === "read" || gate === "write";
       };
       const seesIncome = seesSide("income");
       const seesExpense = seesSide("expense");
       const canViewCompanyFinance = seesIncome || seesExpense;`,
      "стороны",
    );
    assert.doesNotMatch(home, /const canViewCompanyFinance = role === "owner";/);
    assert.doesNotMatch(home, /blockKey: "finance\.operations"/);
  });

  test("строка невидимой стороны не рисуется; месяц с прибылью — только при обеих", () => {
    has(home, `showIncome={seesIncome} showExpense={seesExpense}`, "полоса недели и дня", 2);
    has(home, `showFinance={seesIncome && seesExpense}`, "месяц");
  });
});
