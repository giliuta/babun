import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { hasBlockPreview } from "./preview-keys";
import { WORDED_KEYS, rightTitle, rowWord, stepDanger, stepHint, stepWord } from "./right-words";

// Живые права реестра на 29.09 (`access_blocks where live`) — с их лестницами.
const LIVE: readonly [string, AccessLevel[]][] = [
  ["calendar.create", ["off", "write"]],
  ["calendar.move", ["off", "write"]],
  ["calendar.cancel", ["off", "write"]],
  ["calendar.events", ["off", "read", "write"]],
  ["calendar.day_labels", ["off", "read", "write"]],
  ["calendar.schedule", ["off", "read", "write"]],
  ["record.team", ["read", "write"]],
  ["record.label", ["off", "read", "write"]],
  ["record.color", ["off", "write"]],
  ["record.client", ["off", "read", "write"]],
  ["record.object", ["off", "read", "write"]],
  ["record.services", ["off", "read"]],
  ["record.amount", ["off", "read", "write"]],
  ["record.payment", ["off", "read", "write"]],
  ["record.status", ["read", "write"]],
  ["record.files", ["off", "read", "write"]],
  ["finance.operations", ["off", "read", "write"]],
  // Этап 2 денег: общее «Доходы и расходы» делится на два права.
  ["finance.income", ["off", "read", "write", "full"]],
  ["finance.expense", ["off", "read", "write", "full"]],
  ["finance.accounts", ["off", "read", "write"]],
  ["finance.debts", ["off", "read", "write"]],
  ["clients", ["off", "read", "write"]],
  // Защита базы: «Ограничение по времени» (02.10), блоки карточки.
  // «Открывает карточку», «Телефон», «История записей» и «Карточка из
  // записи» убраны 02.10 — их даёт база.
  ["clients.scope", ["near", "month", "own"]],
  ["clients.note", ["off", "read", "write"]],
  ["clients.people", ["off", "read", "write"]],
  ["clients.objects", ["off", "read", "write"]],
  ["clients.labels", ["off", "read", "write"]],
  ["clients.personal", ["off", "read", "write"]],
  ["clients.files", ["off", "read", "write"]],
  ["clients.requisites", ["off", "read", "write"]],
  ["clients.money", ["off", "read"]],
  ["company.sms_templates", ["off", "read", "write"]],
];

const block = (key: string, levels: AccessLevel[]): AccessBlock => ({
  key,
  area: "calendar",
  scope: "calendar",
  levels,
  title: `сырое имя ${key}`,
  ownerOnly: false,
  live: true,
  position: 0,
});

describe("слова строк прав", () => {
  test("у каждого живого права — своё имя строки", () => {
    for (const [key, levels] of LIVE) {
      assert.ok(WORDED_KEYS.includes(key), `нет имени строки у ${key}`);
      assert.doesNotMatch(rightTitle(block(key, levels)), /сырое имя/);
    }
  });

  test("ступени одного права названы разными словами, у каждой — пояснение", () => {
    for (const [key, levels] of LIVE) {
      const b = block(key, levels);
      const words = levels.map((level) => stepWord(b, level));
      assert.equal(new Set(words).size, words.length, `повтор слова у ${key}: ${words.join(" · ")}`);
      for (const level of levels) {
        assert.ok(stepHint(b, level).length > 8, `нет пояснения ${key}/${level}`);
      }
    }
  });

  test("вид блока в шторке есть у всех прав команды", () => {
    for (const [key] of LIVE) {
      if (key.startsWith("company.")) continue;
      assert.ok(hasBlockPreview(key), `нет вида блока у ${key}`);
    }
  });

  test("опасное — только то, что уносит деньги, данные или записи", () => {
    assert.ok(stepDanger(block("calendar.cancel", ["off", "write"]), "write"));
    assert.ok(stepDanger(block("finance.accounts", ["off", "read", "write"]), "write"));
    assert.equal(stepDanger(block("record.client", ["off", "read", "write"]), "write"), null);
    assert.equal(stepDanger(block("finance.accounts", ["off", "read", "write"]), "read"), null);
    const income = block("finance.income", ["off", "read", "write", "full"]);
    assert.ok(stepDanger(income, "full"), "чужие доходы — опасно");
    assert.equal(stepDanger(income, "write"), null, "свои доходы — не опасно");
    assert.ok(stepDanger(block("finance.debts", ["off", "read", "write"]), "write"), "удаление долгов");
  });

  test("«Счета: Не видит» при приёме оплаты — «Только при оплате»", () => {
    const accounts = block("finance.accounts", ["off", "read", "write"]);
    assert.equal(stepWord(accounts, "off", { "record.payment": "write" }), "Только при оплате");
    assert.match(stepHint(accounts, "off", { "record.payment": "write" }), /только в оплате/);
    assert.equal(stepWord(accounts, "off", { "record.payment": "read" }), "Не видит");
    assert.equal(stepWord(accounts, "off"), "Не видит");
    assert.equal(stepWord(accounts, "read", { "record.payment": "write" }), "Видит");
  });
});

describe("блок карточки клиента правится своим правом (02.10)", () => {
  const note = { key: "clients.note", levels: ["off", "read", "write"] as const };

  test("«Видит и меняет» при «Базе клиентов: Только видит» — на строке как есть", () => {
    assert.equal(rowWord(note, "write", { clients: "read", "clients.note": "write" }), "Видит и меняет");
    assert.doesNotMatch(stepHint(note, "write", { clients: "read" }), /когда у/);
  });

  test("при «Меняет» карточек — как есть; чужие права правило не трогает", () => {
    assert.equal(rowWord(note, "write", { clients: "write" }), "Видит и меняет");
    assert.equal(rowWord(note, "read", { clients: "read" }), "Только видит");
    assert.equal(
      rowWord({ key: "record.note", levels: ["off", "read", "write"] }, "write", { clients: "read" }),
      stepWord({ key: "record.note", levels: ["off", "read", "write"] }, "write"),
    );
  });
});
