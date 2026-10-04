import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountsSettingsHref,
  deletedOperationsDoorLine,
  requisitesDoorLine,
  settingsTeamId,
  teamCategoriesLine,
  teamCategoryKindCount,
  teamCategoryKindLine,
} from "./team-settings-lines";

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
});

describe("двери страниц категорий по виду", () => {
  const cat = (over: Record<string, unknown>) =>
    ({ id: String(Math.random()), name: "x", type: "expense", team_id: "A", hidden: false, is_system: false, monthly_budget: null, ...over }) as never;
  test("число категорий вида у команды и бюджеты у расхода", () => {
    const list = [
      cat({ type: "expense", monthly_budget: 100 }),
      cat({ type: "expense" }),
      cat({ type: "expense", hidden: true }),
      cat({ type: "income" }),
      cat({ type: "income", team_id: "B" }),
    ];
    assert.equal(teamCategoryKindLine(list, "A", "expense"), "2 категории · 1 бюджет");
    assert.equal(teamCategoryKindLine(list, "A", "income"), "1 категория");
    assert.equal(teamCategoryKindLine(list, "A", "debt"), "Пока нет");
  });
});

describe("шестерёнка финансов — числа и подписи (30.09)", () => {
  test("число на плитке — живые категории вида у команды", () => {
    const cats = [
      { team_id: "t1", type: "expense", is_system: false, hidden: false },
      { team_id: "t1", type: "expense", is_system: false, hidden: true },
      { team_id: "t1", type: "expense", is_system: true, hidden: false },
      { team_id: "t2", type: "expense", is_system: false, hidden: false },
      { team_id: "t1", type: "income", is_system: false, hidden: false },
    ] as unknown as Parameters<typeof teamCategoryKindCount>[0];
    assert.equal(teamCategoryKindCount(cats, "t1", "expense"), 1);
    assert.equal(teamCategoryKindCount(cats, "t1", "debt"), 0);
  });

  test("реквизиты — наборы и следующий номер основного", () => {
    assert.equal(requisitesDoorLine(1, "INV-2026-106"), "1 набор · INV-2026-106");
    assert.equal(requisitesDoorLine(3, null), "3 набора");
    assert.equal(requisitesDoorLine(0, "INV-2026-001"), "Пока нет");
  });
});

describe("дверь настроек над счетами — счета выбранной команды (03.10)", () => {
  test("команда выбрана — страница на ней одной", () => {
    assert.equal(accountsSettingsHref("team-1", "__no_team__"), "/accounts/settings?team=team-1");
  });
  test("«Без команды» и все счета — страница всех счетов", () => {
    assert.equal(accountsSettingsHref("__no_team__", "__no_team__"), "/accounts/settings");
    assert.equal(accountsSettingsHref(null, "__no_team__"), "/accounts/settings");
  });
});

describe("deletedOperationsDoorLine", () => {
  test("пусто — словом, иначе число операций", () => {
    assert.equal(deletedOperationsDoorLine(0), "Пусто");
    assert.equal(deletedOperationsDoorLine(1), "1 операция");
    assert.equal(deletedOperationsDoorLine(3), "3 операции");
    assert.equal(deletedOperationsDoorLine(5), "5 операций");
  });
});
