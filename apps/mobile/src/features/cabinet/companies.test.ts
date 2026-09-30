import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MyCalendar } from "../settings/workspaces";
import {
  grantsSummary,
  groupMemberships,
  membershipSubtitle,
  planLabel,
  quotaLine,
} from "./companies";

describe("тариф и лимиты владельца", () => {
  test("тариф словами, незнакомый — как есть, неизвестный — прочерк", () => {
    assert.equal(planLabel("lifetime"), "Без ограничений");
    assert.equal(planLabel("free"), "Бесплатный");
    assert.equal(planLabel("gold"), "gold");
    assert.equal(planLabel(null), "—");
  });

  test("лимит: использовано из скольких, остаток и исчерпание", () => {
    assert.deepEqual(quotaLine({ current: 12, limit: 100 }), {
      value: "12 из 100",
      sub: "Осталось 88",
    });
    assert.deepEqual(quotaLine({ current: 120, limit: 100 }), {
      value: "120 из 100",
      sub: "Лимит исчерпан",
    });
    assert.deepEqual(quotaLine({ current: 7, limit: 999_999_999 }), {
      value: "7",
      sub: "Без ограничений",
    });
  });
});

function row(partial: Partial<MyCalendar>): MyCalendar {
  return {
    tenantId: "t-1",
    tenantName: "AirFix LTD",
    teamId: "team-1",
    teamName: "Y&D",
    teamColor: "#2c5be0",
    role: "owner",
    grants: [],
    isActive: false,
    onboarded: true,
    ...partial,
  };
}

describe("мои компании: сборка из ленты календарей", () => {
  test("календари одной компании собираются в одну строку, порядок календарей сохраняется", () => {
    const companies = groupMemberships(
      [
        row({ teamId: "a", teamName: "Команда 1" }),
        row({ teamId: "b", teamName: "Команда 2" }),
      ],
      "t-1",
    );
    assert.equal(companies.length, 1);
    assert.deepEqual(
      companies[0]?.calendars.map((c) => c.teamName),
      ["Команда 1", "Команда 2"],
    );
  });

  test("«сейчас» решает компания устройства, а не устаревший флаг сервера", () => {
    const companies = groupMemberships(
      [
        row({ tenantId: "t-1", tenantName: "AirFix LTD", isActive: true }),
        row({ tenantId: "t-2", tenantName: "Giliuta", role: "master", isActive: false }),
      ],
      "t-2",
    );
    assert.deepEqual(
      companies.map((c) => [c.tenantName, c.isActive]),
      [
        ["Giliuta", true],
        ["AirFix LTD", false],
      ],
    );
  });

  test("компания устройства ещё не известна — берётся флаг сервера", () => {
    const companies = groupMemberships(
      [row({ tenantId: "t-1", isActive: false }), row({ tenantId: "t-2", isActive: true })],
      null,
    );
    assert.equal(companies[0]?.tenantId, "t-2");
  });

  test("незнакомая роль не выдумывается, пустое имя компании не печатается пустым", () => {
    const [company] = groupMemberships(
      [row({ role: "admin", tenantName: "  " })],
      "t-1",
    );
    assert.equal(company?.role, null);
    assert.equal(company?.tenantName, "Без названия");
  });
});

describe("мои компании: подписи", () => {
  test("подпись: сейчас здесь · роль · число календарей", () => {
    const [company] = groupMemberships(
      [row({ teamId: "a" }), row({ teamId: "b" })],
      "t-1",
    );
    assert.ok(company);
    assert.equal(membershipSubtitle(company), "Сейчас здесь · Владелец · 2 календаря");
  });

  test("склонение числа календарей", () => {
    const make = (count: number) => {
      const rows = Array.from({ length: count }, (_, i) => row({ teamId: `t${i}` }));
      const [company] = groupMemberships(rows, "other");
      assert.ok(company);
      return membershipSubtitle(company);
    };
    assert.equal(make(1), "Владелец · 1 календарь");
    assert.equal(make(5), "Владелец · 5 календарей");
    assert.equal(make(11), "Владелец · 11 календарей");
    assert.equal(make(21), "Владелец · 21 календарь");
    assert.equal(make(22), "Владелец · 22 календаря");
  });

  test("права календаря словами продукта, по порядку, незнакомые не печатаются", () => {
    assert.equal(grantsSummary("owner", []), "Полный доступ");
    assert.equal(
      grantsSummary("dispatcher", ["phones", "view", "unknown", "book", "clients"]),
      "Просмотр · запись · клиенты · телефоны",
    );
    assert.equal(grantsSummary("master", []), "Доступ задаёт роль");
  });
});
