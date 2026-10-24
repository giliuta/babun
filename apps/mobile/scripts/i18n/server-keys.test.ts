import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ТЕКСТ БАЗЫ ДЛЯ ЛЮДЕЙ — ВСЕМИ ФОРМАМИ, КОТОРЫМИ БАЗА ЕГО ПИШЕТ: и
// `raise exception 'текст'`, и `raise exception using errcode = …,
// message = 'текст'`, и причины неотправки SMS в `sms_messages.error_message`.
// Фраза, которой нет в списке, не получает перевода и на любом языке
// показывается по-русски.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { collect, toKey } = require("./server-keys") as {
  collect: () => string[];
  toKey: (message: string) => string;
};

describe("server-keys: messages the database writes for people", () => {
  const keys = new Set(collect());

  it("reads `raise exception using … message = '…'`", () => {
    assert.ok(keys.has("Операция без команды не записывается: выберите команду или счёт команды"));
  });

  it("reads the reasons written into sms_messages.error_message", () => {
    for (const reason of ["SMS у компании не настроены", "Не хватило баланса", "Клиент в чёрном списке"]) {
      assert.ok(keys.has(reason), reason);
    }
  });

  it("turns `%` into value slots", () => {
    assert.equal(toKey("Платёж превышает остаток % %"), "Платёж превышает остаток {0} {1}");
  });
});
