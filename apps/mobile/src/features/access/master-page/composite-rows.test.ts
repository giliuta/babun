import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { draftLevel, emptyMasterDraft, withLevel } from "./master-draft";
import { levelChanges, rightsSections } from "./rights-rows";

// ЦЕПОЧКА БЛОКОВ ЗАПИСИ (владелец 30.09: «продумай логическую цепочку»).
// Реестр — копия живых строк `access_blocks` на 30.09.

const block = (key: string, levels: AccessLevel[], position: number): AccessBlock => ({
  key,
  area: "calendar",
  scope: "calendar",
  levels,
  title: key,
  ownerOnly: false,
  live: true,
  position,
});

const REGISTRY: AccessBlock[] = [
  block("calendar.records", ["off", "read", "write"], 10),
  block("calendar.create", ["off", "write"], 20),
  block("calendar.move", ["off", "write"], 26),
  block("record.status", ["read", "write"], 30),
  block("record.team", ["read", "write"], 31),
  block("record.label", ["off", "read", "write"], 32),
  block("record.client", ["off", "read", "write"], 34),
  block("record.object", ["off", "read", "write"], 35),
  block("record.services", ["off", "read"], 36),
  block("record.color", ["off", "write"], 37),
  block("record.amount", ["off", "read", "write"], 40),
  block("record.payment", ["off", "read", "write"], 50),
  block("record.files", ["off", "read", "write"], 55),
];

const TEAM = "team-1";

const allRowsFor = (levels: Record<string, AccessLevel>) => {
  const levelOf = (b: AccessBlock) => levels[b.key] ?? b.levels[0] ?? "off";
  return rightsSections(REGISTRY, levelOf, TEAM).flatMap((section) => section.rows);
};
/** Живые строки — серые (главный блок скрыт) не считаются. */
const rowsFor = (levels: Record<string, AccessLevel>) => allRowsFor(levels).filter((row) => !row.foldedBy);
const rowOf = (levels: Record<string, AccessLevel>, key: string) =>
  rowsFor(levels).find((row) => row.block.key === key);
const changesOf = (key: string, level: AccessLevel, levels: Record<string, AccessLevel>) => {
  const rowBlock = rowsFor({ "calendar.records": "read", "record.services": "read", "record.amount": "read", ...levels })
    .find((row) => row.block.key === key)?.block;
  assert.ok(rowBlock, `нет строки ${key}`);
  return levelChanges(REGISTRY, rowBlock, level, TEAM, (k) => levels[k] ?? REGISTRY.find((b) => b.key === k)?.levels[0] ?? "off");
};
const asMap = (changes: ReturnType<typeof levelChanges>) =>
  Object.fromEntries((changes ?? []).map((change) => [change.block, change.level]));

describe("цепочка блоков записи", () => {
  test("«Записи клиентов: Скрыты» — живых блоков записи нет, все стоят серыми", () => {
    const keys = rowsFor({ "calendar.records": "off" }).map((row) => row.block.key);
    assert.deepEqual(keys, ["calendar.records"]);
    const grey = allRowsFor({ "calendar.records": "off" }).filter((row) => row.foldedBy);
    assert.ok(grey.length > 0);
    assert.ok(grey.every((row) => row.foldedBy === "calendar.records"));
    assert.ok(grey.some((row) => row.block.key === "record.when"), "«Время» пропало, а не посерело");
  });

  test("«Услуги»: три ступени из двух прав", () => {
    const open = { "calendar.records": "read" } as const;
    assert.equal(rowOf({ ...open }, "record.services")?.level, "off");
    assert.equal(rowOf({ ...open, "record.services": "read" }, "record.services")?.level, "read");
    assert.equal(
      rowOf({ ...open, "record.services": "read", "record.amount": "write" }, "record.services")?.level,
      "write",
    );
    assert.deepEqual(rowOf({ ...open, "record.services": "read" }, "record.services")?.block.levels, ["off", "read", "write"]);
  });

  test("скрыты услуги — «Цены» и «Оплата» серые; скрыты цены — серая «Оплата»", () => {
    const grey = allRowsFor({ "calendar.records": "read", "record.amount": "read" }).filter((r) => r.foldedBy);
    assert.equal(grey.find((r) => r.block.key === "record.amount")?.foldedBy, "record.services");
    assert.equal(grey.find((r) => r.block.key === "record.payment")?.foldedBy, "record.services");
    const noServices = rowsFor({ "calendar.records": "read", "record.amount": "read", "record.payment": "read" }).map((r) => r.block.key);
    assert.equal(noServices.includes("record.amount"), false);
    assert.equal(noServices.includes("record.payment"), false);
    const noPrices = rowsFor({ "calendar.records": "read", "record.services": "read" }).map((r) => r.block.key);
    assert.equal(noPrices.includes("record.amount"), true);
    assert.equal(noPrices.includes("record.payment"), false);
  });

  test("«Услуги: Видит и меняет» — право на суммы; «Цены» стоят на «Видит» и не переключаются", () => {
    assert.deepEqual(asMap(changesOf("record.services", "write", { "record.services": "read" })), {
      "record.services": "read",
      "record.amount": "write",
    });
    const prices = rowOf({ "calendar.records": "read", "record.services": "read", "record.amount": "write" }, "record.amount");
    assert.equal(prices?.level, "read");
    assert.ok(prices?.locked);
    assert.equal(changesOf("record.amount", "off", { "record.services": "read", "record.amount": "write" }) !== null, true);
    assert.equal(changesOf("record.amount", "read", { "record.services": "read", "record.amount": "write" }), null);
  });

  test("«Услуги: Только видит» снимает правку сумм, видимость цен не трогает", () => {
    assert.deepEqual(asMap(changesOf("record.services", "read", { "record.services": "read", "record.amount": "write" })), {
      "record.services": "read",
      "record.amount": "read",
    });
    assert.deepEqual(asMap(changesOf("record.services", "read", { "record.services": "off" })), {
      "record.services": "read",
    });
  });

  test("«Услуги: Скрыты» закрывает цены и оплату — одним набором, без повторов", () => {
    const changes = changesOf("record.services", "off", {
      "record.services": "read",
      "record.amount": "read",
      "record.payment": "write",
    });
    assert.deepEqual(asMap(changes), { "record.services": "off", "record.amount": "off", "record.payment": "off" });
    assert.equal(changes?.length, 3);
  });

  test("«Время» — то же право, что «Перенос записей», вместе с «Цветом»", () => {
    assert.deepEqual(asMap(changesOf("record.when", "write", {})), {
      "calendar.move": "write",
      "record.color": "write",
    });
    assert.deepEqual(asMap(changesOf("record.when", "read", { "calendar.move": "write" })), {
      "calendar.move": "off",
      "record.color": "off",
    });
    assert.equal(rowOf({ "calendar.records": "read", "calendar.move": "write" }, "record.when")?.level, "write");
  });

  test("черновик: «Услуги: Видит и меняет» раскладывается на права реестра", () => {
    let draft = emptyMasterDraft(TEAM);
    const servicesRow = rowsFor({ "calendar.records": "read", "record.services": "read" }).find(
      (row) => row.block.key === "record.services",
    )!.block;
    draft = withLevel(draft, servicesRow, "write", TEAM, REGISTRY);
    const level = (key: string) => draftLevel(REGISTRY.find((b) => b.key === key)!, draft, TEAM);
    assert.equal(level("record.services"), "read");
    assert.equal(level("record.amount"), "write");
  });
});
