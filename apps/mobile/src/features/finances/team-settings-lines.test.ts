import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountsSettingsHref,
  deletedOperationsDoorLine,
  requisitesDoorLine,
  settingsTeamId,
  teamCategoryKindLine,
} from "./team-settings-lines";

describe("настройки финансов команды — подписи дверей", () => {
  test("команда из адреса, если живая; иначе первая; команд нет — ничего", () => {
    const teams = [{ id: "A" }, { id: "B" }];
    assert.equal(settingsTeamId(teams, "B"), "B");
    assert.equal(settingsTeamId(teams, "gone"), "A");
    assert.equal(settingsTeamId(teams, null), "A");
    assert.equal(settingsTeamId([], "A"), null);
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
