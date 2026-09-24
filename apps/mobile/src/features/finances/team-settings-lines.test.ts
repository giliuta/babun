import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { settingsTeamId, teamCategoriesLine, teamTemplatesLine } from "./team-settings-lines";

let n = 0;
const cat = (over: Record<string, unknown>) =>
  ({
    id: `c${++n}`, tenant_id: "t", team_id: "A", slug: "x", name: `Категория ${n}`,
    type: "expense", icon: null, color: null, hidden: false, position: 0,
    ask_employee: false, ask_client: false, require_receipt: false, is_system: false,
    monthly_budget: null, ...over,
  }) as never;

describe("настройки финансов команды — подписи дверей", () => {
  test("команда из адреса, если живая; иначе первая; команд нет — ничего", () => {
    const teams = [{ id: "A" }, { id: "B" }];
    assert.equal(settingsTeamId(teams, "B"), "B");
    assert.equal(settingsTeamId(teams, "gone"), "A");
    assert.equal(settingsTeamId(teams, null), "A");
    assert.equal(settingsTeamId([], "A"), null);
  });

  test("категории — только своей команды, с числом бюджетов", () => {
    const list = [
      cat({ name: "Топливо", monthly_budget: 250 }),
      cat({ name: "Аренда" }),
      cat({ name: "Чаевые", type: "income" }),
      cat({ name: "Топливо", team_id: "B", monthly_budget: 100 }),
      cat({ name: "Старое", hidden: true, monthly_budget: 50 }),
    ];
    assert.equal(teamCategoriesLine(list, "A"), "Расход 2 · доход 1 · 1 бюджет");
    assert.equal(teamCategoriesLine(list, "B"), "Расход 1 · 1 бюджет");
    assert.equal(teamCategoriesLine(list, "C"), "Пока нет — создайте свои");
  });

  test("шаблоны: число или зачем они", () => {
    assert.equal(teamTemplatesLine(0), "Повторяющиеся расходы в один тап");
    assert.equal(teamTemplatesLine(3), "3 шаблона");
    assert.equal(teamTemplatesLine(5), "5 шаблонов");
  });
});
