import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MemberAccessMap } from "@/session/access-map";
import { anyFinanceSetting, financeSettingLevels } from "./settings-levels";

const map = (calendars: Record<string, Record<string, string>>, company: Record<string, string> = {}) =>
  ({
    tenantId: "t1",
    isOwner: false,
    version: 1,
    attachedCalendars: Object.keys(calendars),
    calendars,
    company,
  }) as unknown as MemberAccessMap;

describe("шестерёнка «Финансов» по правам", () => {
  test("владелец правит всё", () => {
    const levels = financeSettingLevels({ role: "owner", map: undefined, teamId: "a" });
    assert.ok(Object.values(levels).every((level) => level === "write"));
  });

  test("партнёр: строки своей команды по ступеням, чужой команды — нет", () => {
    const m = map(
      {
        a: {
          "finance.settings_accounts": "read",
          "finance.settings_categories_expense": "write",
          "finance.settings_trash": "write",
          "finance.settings_requisites": "read",
        },
        b: {},
      },
    );
    const a = financeSettingLevels({ role: "master", map: m, teamId: "a" });
    assert.equal(a.accounts, "read");
    assert.equal(a.categoriesExpense, "write");
    assert.equal(a.categoriesIncome, "hidden");
    assert.equal(a.trash, "write");
    assert.equal(a.requisites, "read");
    assert.equal(a.currency, "hidden");
    const b = financeSettingLevels({ role: "master", map: m, teamId: "b" });
    assert.equal(b.accounts, "hidden");
    // Реквизиты — у календаря: в команде без права их нет.
    assert.equal(b.requisites, "hidden");
  });

  test("валюту и реквизиты партнёр только видит", () => {
    const m = map({ a: { "finance.settings_requisites": "write" } }, { "finance.settings_currency": "write" });
    const a = financeSettingLevels({ role: "master", map: m, teamId: "a" });
    assert.equal(a.currency, "read");
    assert.equal(a.requisites, "read");
  });

  test("карты нет — строк нет, команды в ленте нет", () => {
    const levels = financeSettingLevels({ role: "master", map: undefined, teamId: "a" });
    assert.equal(anyFinanceSetting(levels), false);
  });

  test("без команды — только строка на весь аккаунт (валюта)", () => {
    const m = map(
      { a: { "finance.settings_accounts": "write", "finance.settings_requisites": "read" } },
      { "finance.settings_currency": "read" },
    );
    const none = financeSettingLevels({ role: "master", map: m, teamId: null });
    assert.equal(none.accounts, "hidden");
    assert.equal(none.requisites, "hidden");
    assert.equal(none.currency, "read");
  });
});
