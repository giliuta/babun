import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// КОМАНДА ЖИВЁТ ТОЛЬКО В `select`.
//
// С 2026-09-15 метки дня и графики читаются одним ключом на компанию: команду
// ключ больше не называет, а отбирает её `select`. Значит `select` здесь — не
// украшение, а весь фильтр: удали его или подмени команду — и каждый календарь
// компании покажет метки и графики всех команд сразу. Тест на чистой функции
// отбора (`reference-select.test.ts`) этого не ловит: функция цела, её просто
// не зовут. Хуки тянут react-native и под раннером не поднимаются, поэтому
// проверка — по исходнику, без комментариев.

const here = __dirname;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const sourceOf = (rel: string): string =>
  stripComments(readFileSync(join(here, rel), "utf8"));

/** Тело хука до следующего `export`, пробелы схлопнуты. */
function hookBody(source: string, hook: string): string {
  const start = source.search(new RegExp(`export function ${hook}\\(`));
  assert.ok(start >= 0, `нет хука ${hook}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\nexport /);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

/** Кусок от вызова `useQuery` — объявление `const select` до него сюда не
 *  попадает, и голое слово `select` в нём ничего не доказывает. */
function useQueryCall(body: string, hook: string): string {
  const at = body.indexOf("useQuery");
  assert.ok(at >= 0, `${hook} не зовёт useQuery`);
  return body.slice(at);
}

const PASSES_SELECT = /\bselect\s*[,}]/;

describe("метки дня: ключ компании, команда — select", () => {
  const source = sourceOf("./queries.ts");
  const body = hookBody(source, "useCities");

  test("ключ — весь справочник компании, без команды", () => {
    assert.ok(
      body.includes("queryKey: citiesQueryKey(tenantId, includeInactive, null)"),
      "useCities строит не ключ компании",
    );
  });

  test("select отбирает метки ИМЕННО этой команды", () => {
    assert.match(
      body,
      /const select = useCallback\(\s*\(rows: City\[\]\) => pickTeamLabels\(rows, teamId\),\s*\[teamId\],?\s*\)/,
    );
    assert.match(
      source,
      /import \{[^}]*\bpickTeamLabels\b[^}]*\} from "\.\/reference-select"/,
    );
  });

  test("и этот select передан в useQuery", () => {
    assert.match(useQueryCall(body, "useCities"), PASSES_SELECT);
  });
});

describe("графики: карта компании, команда — select", () => {
  const source = sourceOf("./team-schedule.ts");
  const body = hookBody(source, "useTeamSchedule");

  test("ключ — карта компании", () => {
    assert.ok(
      body.includes("queryKey: allTeamSchedulesQueryKey(tenantId, roleQuery.data)"),
      "useTeamSchedule строит не ключ карты компании",
    );
  });

  test("select берёт график ИМЕННО этой команды и передан в useQuery", () => {
    assert.match(
      body,
      /useCallback\(\s*\(map: ScheduleMap\) => pickTeamSchedule\(map, teamId\)/,
    );
    assert.match(useQueryCall(body, "useTeamSchedule"), PASSES_SELECT);
  });

  test("карта целиком — без select: её читает список календарей", () => {
    assert.doesNotMatch(hookBody(source, "useAllTeamSchedules"), /\bselect\b/);
  });
});

// УСЛУГИ — ТОТ ЖЕ ПРИЁМ (15.09): каталог выбора и полный справочник читают один
// ключ, живые отбирает `select`. Без него владелец увидит к выбору убранные
// услуги.
describe("услуги: один ключ справочника, живые — select", () => {
  const source = sourceOf("../services/queries.ts");
  const body = hookBody(source, "useServices");

  test("каталог выбора читает ключ полного справочника", () => {
    assert.ok(
      body.includes("queryKey: allServicesQueryKey(tenantId, role)"),
      "useServices строит не ключ справочника",
    );
    assert.ok(body.includes("archived: true"), "useServices читает не весь справочник");
  });

  test("select отбирает живые услуги по роли и передан в useQuery", () => {
    assert.match(
      body,
      /const selectLive = useCallback\(\s*\(rows: Service\[\]\) => pickLiveServices\(rows, role\),\s*\[role\],?\s*\)/,
    );
    assert.match(useQueryCall(body, "useServices"), /\bselect:\s*selectLive\b/);
    assert.match(
      source,
      /import \{[^}]*\bpickLiveServices\b[^}]*\} from "@\/features\/reference\/reference-select"/,
    );
  });

  test("полный справочник — без select: по нему читают прошлое", () => {
    assert.doesNotMatch(hookBody(source, "useAllServices"), /\bselect\b/);
  });
});
