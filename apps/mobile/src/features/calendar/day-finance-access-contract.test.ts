import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ДЕНЬГИ В КАЛЕНДАРЕ — ПО УРОВНЮ «ДОХОДЫ И РАСХОДЫ» (этап 2, владелец 15.09:
// «чтоб всё сразу менялось в живом времени»). Экраны тянут react-native и
// под раннером не поднимаются, поэтому проверка — по исходнику: верни проверку
// роли или убери серое «Смотрит» — и сотрудник либо не увидит свои деньги, либо
// увидит кнопку, которую сервер откажет.

const read = (rel: string) =>
  readFileSync(join(__dirname, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

describe("шторка «Финансы дня»", () => {
  const sheet = read("DayFinanceSheet.tsx");

  test("уровень берётся из «Доходов и расходов» ЭТОГО календаря", () => {
    assert.match(
      sheet,
      /const role = useCurrentRole\(\)\.data; const financeGate = accessGate\(\{ role, map: useMyAccess\(\)\.data, blockKey: "finance\.operations", scope: "calendar", teamId, \}\)/,
    );
    assert.match(sheet, /const canWrite = financeGate === "write";/);
  });

  test("«Смотрит»: кнопка на месте, серая, с причиной", () => {
    assert.match(sheet, /<GradientButton label=\{cta\.label\} onPress=\{cta\.onPress\} disabled=\{!canWrite\} \/>/);
    assert.match(sheet, /\{canWrite \? null : \( <Text[^>]*> Только просмотр <\/Text> \)\}/);
  });

  test("«Смотрит»: правка операции и удаление ручной строки закрыты", () => {
    assert.match(
      sheet,
      /if \(canWrite && canEditTransaction\(tx\) && \(role === "owner" \|\| tx\.type === "expense"\)\)/,
    );
    assert.match(sheet, /onRemove=\{teamId && canWrite \? \(\) => askRemoveLegacy\(e\) : undefined\}/);
  });
});

describe("ручные операции дня", () => {
  const queries = read("queries.ts");

  test("читаются по уровню, а не только владельцу", () => {
    assert.match(queries, /enabled: !!tenantId && roleQuery\.isSuccess && \(gate === "read" \|\| gate === "write"\)/);
    assert.doesNotMatch(queries, /role === "owner",/);
  });

  test("меняются только при «Меняет» в этом календаре", () => {
    assert.match(queries, /blockKey: "finance\.operations", scope: "calendar", teamId, \}\); if \(gate !== "write"\)/);
  });
});

describe("полоса денег под календарём", () => {
  const home = read("../../../app/(dashboard)/(home)/index.tsx");

  test("видна по уровню активного календаря, а не по роли", () => {
    assert.match(
      home,
      /const financeGate = accessGate\(\{ role, map: myAccessQuery\.data, blockKey: "finance\.operations", scope: "calendar", teamId: activeTeamId, \}\);/,
    );
    assert.match(home, /const canViewCompanyFinance = financeGate === "read" \|\| financeGate === "write";/);
    assert.doesNotMatch(home, /const canViewCompanyFinance = role === "owner";/);
  });
});
