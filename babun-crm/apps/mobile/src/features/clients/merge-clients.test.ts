import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client } from "@babun/shared/local/clients";
import { createBlankClient } from "@babun/shared/local/clients";
import { mergeClientPatch, phoneKey } from "./merge-clients";

// Слияние необратимо для записей (они меняют владельца), поэтому правило
// одно: ДОПОЛНЯТЬ, но не затирать. Ошибка здесь стирает историю живого
// клиента чужой пустотой.

const client = (over: Partial<Client>): Client =>
  ({ ...createBlankClient(), id: "c1", ...over }) as Client;

describe("слияние дублей", () => {
  test("пустое поле основной карточки заполняется из дубля", () => {
    const patch = mergeClientPatch(
      client({ email: "", birthday: "" }),
      client({ id: "c2", email: "a@b.cy", birthday: "1990-05-01" }),
    );
    assert.equal(patch.email, "a@b.cy");
    assert.equal(patch.birthday, "1990-05-01");
  });

  test("заполненное поле НЕ затирается", () => {
    const patch = mergeClientPatch(
      client({ email: "main@b.cy" }),
      client({ id: "c2", email: "dup@b.cy" }),
    );
    assert.equal(patch.email, undefined);
  });

  test("номер дубля становится дополнительным", () => {
    const patch = mergeClientPatch(
      client({ phone: "+357 99 111111" }),
      client({ id: "c2", phone: "+357 99 222222" }),
    );
    assert.equal(patch.phones?.length, 1);
    assert.equal(patch.phones?.[0]?.number, "+357 99 222222");
  });

  test("тот же номер в другом написании не дублируется", () => {
    const patch = mergeClientPatch(
      client({ phone: "+357 99 111111" }),
      client({ id: "c2", phone: "99111111" }),
    );
    assert.equal(patch.phones, undefined);
  });

  test("объекты складываются, основной остаётся прежним", () => {
    const patch = mergeClientPatch(
      client({
        locations: [
          { id: "l1", label: "Дом", address: "Ленина 1", isPrimary: true },
        ],
      }),
      client({
        id: "c2",
        locations: [
          { id: "l2", label: "Офис", address: "Мира 5", isPrimary: true },
        ],
      }),
    );
    assert.equal(patch.locations?.length, 2);
    assert.equal(patch.locations?.[0]?.isPrimary, true);
    assert.equal(patch.locations?.[1]?.isPrimary, false);
  });

  test("одинаковый адрес не заводится дважды", () => {
    const patch = mergeClientPatch(
      client({
        locations: [
          { id: "l1", label: "Дом", address: "Ленина 1", isPrimary: true },
        ],
      }),
      client({
        id: "c2",
        locations: [
          { id: "l2", label: "Дом", address: "ленина 1 ", isPrimary: true },
        ],
      }),
    );
    assert.equal(patch.locations, undefined);
  });

  test("заметки обеих карточек, свежие сверху", () => {
    const patch = mergeClientPatch(
      client({
        notes: [{ id: "n1", text: "старая", created_at: "2026-01-01T00:00:00Z" }],
      }),
      client({
        id: "c2",
        notes: [{ id: "n2", text: "новая", created_at: "2026-06-01T00:00:00Z" }],
      }),
    );
    assert.deepEqual(patch.notes?.map((n) => n.text), ["новая", "старая"]);
  });

  test("чёрный список липкий, а балансы НЕ складываются", () => {
    const patch = mergeClientPatch(
      client({ blacklisted: false, balance: -50 }),
      client({ id: "c2", blacklisted: true, balance: -30 }),
    );
    assert.equal(patch.blacklisted, true);
    // Повторное слияние не должно удваивать сумму, а архив дубля —
    // воскрешать её при восстановлении. Поле в продукте мёртвое.
    assert.equal(patch.balance, undefined);
  });

  test("повторное слияние не дублирует заметки", () => {
    const note = { id: "n1", text: "звонила", created_at: "2026-06-01T00:00:00Z" };
    // Второй заход: заметка дубля уже переехала первой попыткой.
    const patch = mergeClientPatch(
      client({ notes: [note] }),
      client({ id: "c2", notes: [note] }),
    );
    assert.equal(patch.notes, undefined);
  });

  test("слияние не делает клиента приведённым самим собой", () => {
    const patch = mergeClientPatch(
      client({ id: "c1" }),
      client({ id: "c2", referred_by_client_id: "c1" }),
    );
    assert.equal(patch.referred_by_client_id, undefined);
  });

  test("ключ номера сводит форматы к одному", () => {
    assert.equal(phoneKey("+357 99 12 34 56"), phoneKey("99123456"));
    assert.equal(phoneKey("0035799123456"), phoneKey("+357 99123456"));
  });
});
