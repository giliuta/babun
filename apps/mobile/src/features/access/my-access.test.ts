import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessLevel, MemberAccessMap } from "./access-map";
import {
  accessGate,
  bestCalendarLevel,
  FINANCE_BLOCK_KEYS,
  isFinanceDataKey,
  isNewerAccess,
  canEditMoneyRow,
  clientLevelsChange,
  isClientDataKey,
  lostAccess,
  moneyKey,
  recordLevelsChanged,
} from "./my-access";

describe("деньги, которые стираются при понижении", () => {
  const T = "tenant-1";

  test("ключи денег этой компании — да; другой компании и не денег — нет", () => {
    assert.equal(isFinanceDataKey(["transactions", T, "2026-09-01", "2026-09-30", null, null], T), true);
    assert.equal(isFinanceDataKey(["debts", T, "paid-totals"], T), true);
    assert.equal(isFinanceDataKey(["accounts", T, "balances"], T), true);
    assert.equal(isFinanceDataKey(["day-extras", T, "master"], T), true);
    assert.equal(isFinanceDataKey(["transfer-counterpart", T, "group-1"], T), true);
    assert.equal(isFinanceDataKey(["appointment-ledger", T, "appt-1"], T), true);
    assert.equal(isFinanceDataKey(["transactions", "tenant-2", "x"], T), false);
    assert.equal(isFinanceDataKey(["appointments", T, "master"], T), false);
    assert.equal(isFinanceDataKey(["my-access", T], T), false);
  });

  test("все блоки финансов в списке понижения", () => {
    for (const key of [
      "finance.income",
      "finance.expense",
      "finance.operations",
      "finance.accounts",
      "finance.debts",
      "finance.documents",
      "finance.categories",
      "finance.templates",
      "finance.vat",
    ]) {
      assert.ok(FINANCE_BLOCK_KEYS.includes(key), key);
    }
  });
});

const map = (over: Partial<MemberAccessMap> = {}): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner: false,
  version: 7,
  company: {},
  calendars: {},
  attachedCalendars: [],
  ...over,
});

const OPS = "finance.operations";

describe("ворота блока", () => {
  test("владелец меняет всё и не ждёт карту", () => {
    assert.equal(accessGate({ role: "owner", map: undefined, blockKey: OPS, scope: "calendar" }), "write");
  });

  test("роль или карта ещё едут — ждать, а не «скрыт»", () => {
    assert.equal(accessGate({ role: undefined, map: map(), blockKey: OPS, scope: "calendar" }), "loading");
    assert.equal(accessGate({ role: "master", map: undefined, blockKey: OPS, scope: "calendar" }), "loading");
  });

  test("человека в компании нет — граница, а не серая страница", () => {
    assert.equal(accessGate({ role: null, map: map(), blockKey: OPS, scope: "calendar" }), "gone");
  });

  test("календарный блок читается по своему календарю", () => {
    const m = map({ calendars: { "team-1": { [OPS]: "write" }, "team-2": { [OPS]: "read" } } });
    const at = (teamId: string) =>
      accessGate({ role: "master", map: m, blockKey: OPS, scope: "calendar", teamId });
    assert.equal(at("team-1"), "write");
    assert.equal(at("team-2"), "read");
    assert.equal(at("team-3"), "locked");
  });

  test("без календаря — лучший по всем; нигде нет — скрыт", () => {
    const m = map({ calendars: { "team-1": { [OPS]: "read" }, "team-2": { [OPS]: "off" } } });
    assert.equal(accessGate({ role: "master", map: m, blockKey: OPS, scope: "calendar" }), "read");
    assert.equal(accessGate({ role: "master", map: map(), blockKey: OPS, scope: "calendar" }), "locked");
  });

  test("блок компании читается из компании, не из календарей", () => {
    const m = map({ company: { "finance.categories": "read" }, calendars: { "team-1": { "finance.categories": "write" } } });
    assert.equal(
      accessGate({ role: "dispatcher", map: m, blockKey: "finance.categories", scope: "company" }),
      "read",
    );
  });

  test("охват «Все» — не доступ; карта владельца — меняет", () => {
    const m = map({ company: { "clients.scope": "all" } });
    assert.equal(accessGate({ role: "master", map: m, blockKey: "clients.scope", scope: "company" }), "locked");
    assert.equal(
      accessGate({ role: "master", map: map({ isOwner: true }), blockKey: OPS, scope: "calendar", teamId: "x" }),
      "write",
    );
  });

  test("лучшее положение по календарям", () => {
    const m = map({ calendars: { a: { [OPS]: "read" }, b: { [OPS]: "write" }, c: {} } });
    assert.equal(bestCalendarLevel(m, OPS), "write");
    assert.equal(bestCalendarLevel(map(), OPS), undefined);
  });

  test("«Правит всё» — выше «Меняет»: ворота открыты, понижение до «Меняет» — понижение", () => {
    const INCOME = "finance.income";
    const full = map({ calendars: { a: { [INCOME]: "full" }, b: { [INCOME]: "write" } } });
    assert.equal(accessGate({ role: "master", map: full, blockKey: INCOME, scope: "calendar", teamId: "a" }), "write");
    assert.equal(bestCalendarLevel(full, INCOME), "full");
    const lowered = map({ calendars: { a: { [INCOME]: "write" }, b: { [INCOME]: "write" } } });
    assert.equal(lostAccess(full, lowered, [INCOME]), true);
    assert.equal(lostAccess(lowered, full, [INCOME]), false);
  });
});

describe("сторона денег — новый ключ или старый общий", () => {
  test("карта после наката — свои ключи доходов и расходов", () => {
    const m = map({ calendars: { a: { "finance.income": "read", "finance.expense": "full" } } });
    assert.equal(moneyKey(m, "income"), "finance.income");
    assert.equal(moneyKey(m, "expense"), "finance.expense");
  });

  test("карта до наката — общий «Доходы и расходы» за обе стороны", () => {
    const m = map({ calendars: { a: { [OPS]: "write" } } });
    assert.equal(moneyKey(m, "income"), OPS);
    assert.equal(moneyKey(m, "expense"), OPS);
  });

  test("карты нет или календарей нет — новый ключ: ворота всё равно закрыты или владелец", () => {
    assert.equal(moneyKey(undefined, "income"), "finance.income");
    assert.equal(moneyKey(map(), "expense"), "finance.expense");
  });
});

describe("править ручную операцию — ровно то, что пустит сервер", () => {
  const ME = "user-me";
  const edit = (levels: Record<string, AccessLevel>, side: "income" | "expense", createdBy: string | null) =>
    canEditMoneyRow({ role: "master", map: map({ calendars: { a: levels } }), teamId: "a", side, createdBy, me: ME });

  test("«Правит всё» — любую строку команды, и без автора тоже", () => {
    assert.equal(edit({ "finance.income": "full" }, "income", "someone"), true);
    assert.equal(edit({ "finance.income": "full" }, "income", null), true);
  });

  test("«Добавляет» — только свою; чужую и без автора — нет", () => {
    assert.equal(edit({ "finance.expense": "write" }, "expense", ME), true);
    assert.equal(edit({ "finance.expense": "write" }, "expense", "someone"), false);
    assert.equal(edit({ "finance.expense": "write" }, "expense", null), false);
  });

  test("«Видит» и чужая сторона — нет", () => {
    assert.equal(edit({ "finance.income": "read", "finance.expense": "full" }, "income", ME), false);
  });

  test("старая карта: «Меняет» правит любой расход, доход — никогда", () => {
    assert.equal(edit({ [OPS]: "write" }, "expense", "someone"), true);
    assert.equal(edit({ [OPS]: "write" }, "income", ME), false);
  });

  test("владелец — любую; без календаря сотрудник — ничего", () => {
    assert.equal(canEditMoneyRow({ role: "owner", map: undefined, teamId: null, side: "income", createdBy: null, me: ME }), true);
    assert.equal(
      canEditMoneyRow({ role: "master", map: map({ calendars: { a: { "finance.income": "full" } } }), teamId: null, side: "income", createdBy: null, me: ME }),
      false,
    );
  });
});

describe("сигнал смены прав", () => {
  test("перечитывать только новее того, что есть", () => {
    assert.equal(isNewerAccess(8, map({ version: 7 })), true);
    assert.equal(isNewerAccess(7, map({ version: 7 })), false);
    assert.equal(isNewerAccess(6, map({ version: 7 })), false);
    assert.equal(isNewerAccess("8", map({ version: 7 })), false);
    assert.equal(isNewerAccess(undefined, undefined), true);
  });

  test("понижение в любом календаре или в компании — стирать данные", () => {
    const before = map({
      company: { "finance.categories": "write" },
      calendars: { "team-1": { [OPS]: "write" }, "team-2": { [OPS]: "read" } },
    });
    const keys = [OPS, "finance.categories"];
    assert.equal(
      lostAccess(before, map({ ...before, calendars: { ...before.calendars, "team-1": { [OPS]: "read" } } }), keys),
      true,
    );
    assert.equal(lostAccess(before, map({ ...before, calendars: { "team-1": { [OPS]: "write" } } }), keys), true);
    assert.equal(lostAccess(before, map({ ...before, company: {} }), keys), true);
    assert.equal(lostAccess(map({ isOwner: true }), before, keys), true);
  });

  test("повышение и чужие блоки — не понижение", () => {
    const before = map({ calendars: { "team-1": { [OPS]: "read" } } });
    assert.equal(lostAccess(before, map({ calendars: { "team-1": { [OPS]: "write" } } }), [OPS]), false);
    assert.equal(
      lostAccess(before, map({ calendars: { "team-1": { [OPS]: "read", "calendar.records": "off" } } }), [OPS]),
      false,
    );
    assert.equal(lostAccess(undefined, before, [OPS]), false);
  });
});

describe("строки записей перечитываются, когда меняется блок записи", () => {
  const base = (levels: Record<string, "off" | "read" | "write">): MemberAccessMap => ({
    tenantId: "tenant-1",
    isOwner: false,
    version: 1,
    company: {},
    calendars: { "team-1": levels },
    attachedCalendars: ["team-1"],
  });

  test("подняли «Сумму» — перечитать: старые строки пришли с нулями", () => {
    assert.equal(
      recordLevelsChanged(base({ "record.amount": "off" }), base({ "record.amount": "read" })),
      true,
    );
  });

  test("блок записи появился впервые или пропал — тоже смена", () => {
    assert.equal(recordLevelsChanged(base({}), base({ "record.client": "read" })), true);
    assert.equal(recordLevelsChanged(base({ "record.object": "read" }), base({})), true);
  });

  test("финансы и первая загрузка записи не трогают", () => {
    assert.equal(
      recordLevelsChanged(base({ "finance.operations": "read" }), base({ "finance.operations": "write" })),
      false,
    );
    assert.equal(recordLevelsChanged(undefined, base({ "record.amount": "read" })), false);
    assert.equal(
      recordLevelsChanged(base({ "record.amount": "read" }), base({ "record.amount": "read" })),
      false,
    );
  });
});

describe("клиенты уходят с телефона, когда права сузили (защита базы 30.09)", () => {
  const T = "tenant-1";
  const team = (levels: Record<string, AccessLevel>) => map({ calendars: { A: levels } });
  const base = { clients: "read", "clients.scope": "own" } as const;

  test("ключи клиентов этой компании — да; другой компании и не клиентов — нет", () => {
    assert.equal(isClientDataKey(["clients", T, "member:read:own:phones"], T), true);
    assert.equal(isClientDataKey(["client", "c1", T, "member:read:own:phones"], T), true);
    assert.equal(isClientDataKey(["client-contacts", T, "c1"], T), true);
    assert.equal(isClientDataKey(["client-members", T, "g1"], T), true);
    assert.equal(isClientDataKey(["clients", "tenant-2", "x"], T), false);
    assert.equal(isClientDataKey(["client", "c1", "tenant-2", "x"], T), false);
    assert.equal(isClientDataKey(["appointments", T, "master"], T), false);
  });

  test("«Своей команды» → «Месяц» → «2 недели», снятая команда — сужение", () => {
    assert.equal(clientLevelsChange(team(base), team({ ...base, "clients.scope": "month" })), "narrowed");
    assert.equal(clientLevelsChange(team({ ...base, "clients.scope": "month" }), team({ ...base, "clients.scope": "near" })), "narrowed");
    assert.equal(clientLevelsChange(team(base), team({ ...base, "clients.scope": "near" })), "narrowed");
    assert.equal(clientLevelsChange(team(base), team({ ...base, clients: "off" })), "narrowed");
    assert.equal(clientLevelsChange(team(base), map({ calendars: {} })), "narrowed");
  });

  test("расширили — перечитать, не стирать; ничего не поменяли и первая загрузка — ничего", () => {
    assert.equal(clientLevelsChange(team(base), team({ ...base, "clients.scope": "all" })), "changed");
    assert.equal(clientLevelsChange(team({ ...base, "clients.scope": "month" }), team(base)), "changed");
    assert.equal(clientLevelsChange(team(base), team({ ...base, "record.team": "write" })), "same");
    assert.equal(clientLevelsChange(undefined, team(base)), "same");
  });

  test("закрыли блок карточки — сужение; открыли — перечитать", () => {
    const withNote = { ...base, "clients.note": "read" } as const;
    assert.equal(clientLevelsChange(team(withNote), team({ ...withNote, "clients.note": "off" })), "narrowed");
    assert.equal(clientLevelsChange(team(base), team({ ...base, "clients.files": "read" })), "changed");
  });

  test("«Меню клиента» и «Удаление клиента» сузили — сужение (аудит 03.10)", () => {
    const withMenu = { ...base, "clients.menu": "write", "clients.delete": "write" } as const;
    assert.equal(clientLevelsChange(team(withMenu), team({ ...withMenu, "clients.delete": "off" })), "narrowed");
    assert.equal(clientLevelsChange(team(withMenu), team({ ...withMenu, "clients.menu": "off" })), "narrowed");
    assert.equal(clientLevelsChange(team(base), team({ ...base, "clients.menu": "write" })), "changed");
  });

  test("владелец, ставший сотрудником, — сужение", () => {
    assert.equal(clientLevelsChange(map({ isOwner: true }), team(base)), "narrowed");
  });
});
