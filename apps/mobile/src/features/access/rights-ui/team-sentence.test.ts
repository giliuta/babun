import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessLevel } from "../access-map";
import { joinRu, teamBrief, teamSentence } from "./team-sentence";

const reader = (levels: Record<string, AccessLevel>) => (key: string) => levels[key];

// Реестр на 29.09: всё, о чём итог говорит, — живое.
const CLOSED: Record<string, AccessLevel> = {
  "calendar.create": "off",
  "calendar.move": "off",
  "calendar.cancel": "off",
  "record.status": "read",
  "record.client": "off",
  "record.object": "read",
  "record.services": "read",
  "record.amount": "off",
  "record.payment": "off",
  "record.files": "off",
  "finance.operations": "off",
  "finance.accounts": "off",
  "finance.debts": "off",
  clients: "off",
  "clients.scope": "own",
  "clients.contacts": "off",
};

describe("итог прав команды", () => {
  test("перечисление по-русски", () => {
    assert.equal(joinRu(["a"]), "a");
    assert.equal(joinRu(["a", "b"]), "a и b");
    assert.equal(joinRu(["a", "b", "c"]), "a, b и c");
  });

  test("стартовый мастер: только смотрит, без клиента и денег, удалять не может", () => {
    assert.equal(
      teamSentence(reader(CLOSED)),
      "Только смотрит записи команды — без клиента, цен, оплаты и файлов. Базу клиентов не видит. Деньги закрыты. Записи и деньги удалить не может.",
    );
  });

  test("в записи закрыто всё — «только время и статус», дела отдельной фразой", () => {
    const allOff = {
      ...CLOSED,
      "record.label": "off",
      "record.object": "off",
      "record.services": "off",
      "calendar.create": "write",
    } satisfies Record<string, AccessLevel>;
    assert.match(teamSentence(reader(allOff)), /^Видит у записей команды только время и статус\. Создаёт записи\. Базу/);
  });

  test("правка внутри записи — уже не «только смотрит»", () => {
    const text = teamSentence(reader({ ...CLOSED, "record.files": "write" }));
    assert.match(text, /^Видит записи команды без клиента, цен и оплаты\. Базу/);
  });

  test("старший: создаёт, переносит, видит своих клиентов с телефонами, принимает оплату", () => {
    const levels: Record<string, AccessLevel> = {
      ...CLOSED,
      "calendar.create": "write",
      "calendar.move": "write",
      "record.status": "write",
      "record.client": "write",
      "record.amount": "read",
      "record.payment": "write",
      "record.files": "write",
      clients: "read",
      "clients.contacts": "read",
      "finance.debts": "read",
    };
    assert.equal(
      teamSentence(reader(levels)),
      "Видит записи команды полностью. Создаёт и переносит записи, ставит статус. Видит своих клиентов. Принимает оплату и видит долги. Записи и деньги удалить не может.",
    );
  });

  test("опасное право гасит обещание про удаление", () => {
    const text = teamSentence(reader({ ...CLOSED, "finance.accounts": "write", clients: "write", "clients.scope": "all" }));
    assert.match(text, /Ведёт всех клиентов без телефонов\./);
    assert.match(text, /Управляет счетами\./);
    assert.doesNotMatch(text, /удалить не может/);
    const riskySets: readonly Record<string, AccessLevel>[] = [
      { "calendar.cancel": "write" },
      { "finance.debts": "write" },
      { "finance.operations": "write" },
    ];
    for (const risky of riskySets) {
      assert.doesNotMatch(teamSentence(reader({ ...CLOSED, ...risky })), /удалить не может/, JSON.stringify(risky));
    }
  });

  test("выжимка для строки команды — главное через точку", () => {
    // Неразрывный пробел перед точкой — здесь пробелом, чтобы читалось.
    const brief = (levels: Record<string, AccessLevel>) => teamBrief(reader(levels)).replaceAll(" ", " ");
    assert.equal(brief(CLOSED), "Только смотрит записи · клиентов не видит · деньги закрыты");
    assert.equal(
      brief({ ...CLOSED, "calendar.create": "write", "calendar.move": "write", clients: "write", "clients.scope": "all", "record.payment": "write" }),
      "Создаёт и переносит записи · ведёт всех клиентов · принимает оплату",
    );
    assert.equal(
      brief({ ...CLOSED, "record.files": "write" }),
      "Записи не создаёт и не переносит · клиентов не видит · деньги закрыты",
    );
    assert.doesNotMatch(teamBrief(reader(CLOSED)), / ·/, "перед точкой — только неразрывный пробел");
  });

  describe("доходы и расходы — два права (этап 2)", () => {
    // Реестр после наката: общего `finance.operations` нет, есть две стороны.
    const SPLIT: Record<string, AccessLevel | undefined> = {
      ...CLOSED,
      "finance.operations": undefined,
      "finance.income": "off",
      "finance.expense": "off",
    };
    const say = (over: Record<string, AccessLevel>) => teamSentence((key) => ({ ...SPLIT, ...over })[key]);

    test("равные ступени — одной фразой, разные — по стороне", () => {
      assert.match(say({ "finance.income": "read", "finance.expense": "read" }), /Видит доходы и расходы\./);
      assert.match(say({ "finance.income": "write", "finance.expense": "read" }), /Добавляет доходы и видит расходы\./);
      assert.match(say({ "finance.expense": "full" }), /Правит все расходы\./);
      assert.match(say({}), /Деньги закрыты\./);
    });

    test("своё удаляет — обещание про чужое; чужое правит — обещания нет", () => {
      assert.match(say({ "finance.expense": "write" }), /Чужие записи и деньги удалить не может\.$/);
      assert.doesNotMatch(say({ "finance.income": "full" }), /удалить не может/);
      assert.match(say({ "finance.income": "read" }), /Записи и деньги удалить не может\.$/);
    });

    test("долги: оплата долгов — своими словами", () => {
      assert.match(say({ "finance.debts": "write" }), /Принимает оплату долгов\./);
    });
  });

  test("права клиентов нет в реестре — о клиентах молчит", () => {
    const levels = { ...CLOSED } as Record<string, AccessLevel | undefined>;
    delete levels.clients;
    assert.doesNotMatch(teamSentence((key) => levels[key]), /клиентов/);
  });
});
