import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "@/session/access-map";
import { partnerManager, stepAllowed, teamsAllowed } from "./partner-manager";

// ДИРЕКТОР (с собой он не может: сам себе доступ не
// выдаёт). Копия границ сервера (`partners_manageable`,
// `partners_check_caps`): разойдутся — на странице прав появится дверь,
// которая кончится отказом, или пропадёт та, что работает.

const map = (company: Record<string, string>, calendars: Record<string, Record<string, string>> = {}): MemberAccessMap =>
  ({
    tenantId: "ten",
    isOwner: false,
    version: 1,
    company,
    calendars,
    attachedCalendars: Object.keys(calendars),
  }) as MemberAccessMap;

const director = { role: "master", myMap: map({ "company.partners": "write" }, { t1: { "finance.income": "write", "calendar.records": "write" } }), me: "dir" };
const income = { key: "finance.income", scope: "calendar" as const, levels: ["off", "read", "write", "full"] as const };

describe("кем управляет директор", () => {
  test("обычным партнёром — да, без «его глазами»", () => {
    const m = partnerManager(director, { userId: "x", map: map({}, { t1: {} }) });
    assert.deepEqual(m, { readOnly: null, canPreview: false, canRemove: true });
  });

  test("убрать — только партнёра своих команд", () => {
    assert.equal(partnerManager(director, { userId: "x", map: map({}, { t1: {}, t2: {} }) }).canRemove, false);
    assert.equal(partnerManager(director, { userId: "x", map: map({}) }).canRemove, false);
    assert.equal(partnerManager(director, { userId: "x", map: undefined }).canRemove, false);
  });

  test("партнёром чужих команд и без команд — нет, его ведёт владелец", () => {
    for (const target of [map({}, { t2: {} }), map({}), undefined]) {
      assert.deepEqual(partnerManager(director, { userId: "x", map: target }), {
        readOnly: "Права партнёра чужих команд меняет владелец",
        canPreview: false,
        canRemove: false,
      });
    }
  });

  test("собой и другим директором — нет", () => {
    assert.equal(partnerManager(director, { userId: "dir", map: map({}) }).readOnly, "Свои права меняет владелец");
    assert.equal(
      partnerManager(director, { userId: "y", map: map({ "company.partners": "read" }) }).readOnly,
      "Права директора меняет владелец",
    );
  });

  test("партнёр без права «Управляет» — только смотрит", () => {
    const viewer = { role: "master", myMap: map({ "company.partners": "read" }), me: "p" };
    assert.equal(partnerManager(viewer, { userId: "x", map: map({}) }).canRemove, false);
  });

  test("владелец — всё", () => {
    assert.deepEqual(partnerManager({ role: "owner", myMap: undefined, me: "o" }, { userId: "x", map: undefined }), {
      readOnly: null,
      canPreview: true,
      canRemove: true,
    });
  });
});

describe("ступени директора — не выше своих", () => {
  test("«Добавляет» можно, «Правит всё» — нет", () => {
    assert.equal(stepAllowed(director, income, "t1", "write"), true);
    assert.equal(stepAllowed(director, income, "t1", "full"), false);
  });

  test("«Сумма» и «Оплата» без «Услуг» у директора не действуют", () => {
    const levels = ["off", "read", "write"] as const;
    const amount = { key: "record.amount", scope: "calendar" as const, levels };
    const payment = { key: "record.payment", scope: "calendar" as const, levels };
    const cut = {
      role: "master",
      myMap: map(
        { "company.partners": "write" },
        { t1: { "record.services": "off", "record.amount": "write", "record.payment": "write" } },
      ),
    };
    assert.equal(stepAllowed(cut, amount, "t1", "read"), false);
    assert.equal(stepAllowed(cut, payment, "t1", "read"), false);
    const open = {
      role: "master",
      myMap: map(
        { "company.partners": "write" },
        { t1: { "record.services": "read", "record.amount": "off", "record.payment": "write" } },
      ),
    };
    assert.equal(stepAllowed(open, payment, "t1", "read"), false);
    const full = {
      role: "master",
      myMap: map({ "company.partners": "write" }, { t1: { "record.services": "read", "record.amount": "write" } }),
    };
    assert.equal(stepAllowed(full, amount, "t1", "write"), true);
  });

  test("в чужой команде — ничего", () => {
    assert.equal(stepAllowed(director, income, "t3", "read"), false);
  });

  test("право «Партнёры» — только владелец", () => {
    const partners = { key: "company.partners", scope: "company" as const, levels: ["off", "read", "write"] as const };
    assert.equal(stepAllowed(director, partners, null, "read"), false);
    assert.equal(stepAllowed({ role: "owner", myMap: undefined }, partners, null, "write"), true);
  });

  test("команды — только свои", () => {
    assert.deepEqual([...(teamsAllowed(director) ?? [])], ["t1"]);
    assert.equal(teamsAllowed({ role: "owner", myMap: undefined }), null);
  });
});
