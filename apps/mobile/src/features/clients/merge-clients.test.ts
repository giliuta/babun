import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client } from "@babun/shared/local/clients";
import { createBlankClient } from "@babun/shared/local/clients";
import { mergeBlocker, mergeClientPatch, phoneKey } from "./merge-clients";

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

  // STORY-086, дыра 2: слили две карточки Натальи — связи дубля не должны
  // остаться на архивной карточке.
  test("связи обеих карточек складываются без повторов", () => {
    const patch = mergeClientPatch(
      client({ memberships: [{ group_id: "g1", role: "жилец", location_id: "v5" }] }),
      client({
        id: "c2",
        memberships: [
          { group_id: "g1", role: "жилец", location_id: "v5" },
          { group_id: "g1", role: "жилец", location_id: "v7" },
          { group_id: "g2", role: "управляющая" },
        ],
      }),
    );
    assert.deepEqual(
      patch.memberships?.map((m) => `${m.group_id}:${m.location_id ?? ""}`),
      ["g1:v5", "g1:v7", "g2:"],
    );
  });

  test("роль основной не затирается, пустая — берётся у дубля", () => {
    const kept = mergeClientPatch(
      client({ memberships: [{ group_id: "g1", role: "жена" }] }),
      client({ id: "c2", memberships: [{ group_id: "g1", role: "супруга" }] }),
    );
    assert.equal(kept.memberships, undefined);
    const filledIn = mergeClientPatch(
      client({ memberships: [{ group_id: "g1", role: "" }] }),
      client({ id: "c2", memberships: [{ group_id: "g1", role: "жена" }] }),
    );
    assert.deepEqual(filledIn.memberships, [{ group_id: "g1", role: "жена" }]);
  });

  test("слияние не оставляет связи на самих себя", () => {
    // Основная входила в дубль, дубль — в основную: после слияния это один
    // человек, и обе связи должны уйти.
    const patch = mergeClientPatch(
      client({
        id: "c1",
        memberships: [
          { group_id: "c2", role: "жена" },
          { group_id: "g1", role: "жилец" },
        ],
      }),
      client({ id: "c2", memberships: [{ group_id: "c1", role: "муж" }] }),
    );
    assert.deepEqual(patch.memberships, [{ group_id: "g1", role: "жилец" }]);
  });

  test("слить нельзя, пока у дубля есть люди", () => {
    assert.equal(
      mergeBlocker({ id: "c1" }, { id: "c2" }, ["p1"]),
      "У дубля есть свои люди — уберите их там свайпом «Убрать» и привяжите здесь",
    );
    assert.equal(mergeBlocker({ id: "c1" }, { id: "c2" }, []), null);
  });

  test("основная среди людей дубля слиянию не мешает", () => {
    // Её связь на дубль снимает сам патч.
    assert.equal(mergeBlocker({ id: "c1" }, { id: "c2" }, ["c1"]), null);
  });

  test("люди дубля неизвестны — слить нельзя", () => {
    assert.notEqual(mergeBlocker({ id: "c1" }, { id: "c2" }, null), null);
  });

  test("карточку с самой собой не сливают", () => {
    assert.notEqual(mergeBlocker({ id: "c1" }, { id: "c1" }, []), null);
  });

  test("ключ номера сводит форматы к одному", () => {
    assert.equal(phoneKey("+357 99 12 34 56"), phoneKey("99123456"));
    assert.equal(phoneKey("0035799123456"), phoneKey("+357 99123456"));
  });
});

describe("слияние: тег один, реквизиты переезжают", () => {
  const base = (over: Partial<Client>): Client => ({ ...createBlankClient({ full_name: "x" }), ...over });
  test("тег основной главнее; своего нет — берём тег дубля", () => {
    assert.equal(mergeClientPatch(base({ tag_ids: ["a"] }), base({ tag_ids: ["b"] })).tag_ids, undefined);
    assert.deepEqual(mergeClientPatch(base({ tag_ids: [] }), base({ tag_ids: ["b", "c"] })).tag_ids, ["b"]);
  });
  test("наборы реквизитов дубля переезжают без повторов, основной остаётся", () => {
    const set = (id: string, legal: string, vat: string, def: boolean) => ({
      id, legal_name: legal, vat_number: vat, reg_number: null, billing_address: null, is_default: def,
    });
    const primary = base({ requisites: [set("p1", "Gem Ltd", "CY1", true)] });
    const dup = base({ id: "dupid-000000", requisites: [set("d1", "gem ltd", "cy1", true), set("d2", "Villa Co", "CY2", false)] });
    const patch = mergeClientPatch(primary, dup);
    assert.deepEqual(patch.requisites?.map((s) => s.legal_name), ["Gem Ltd", "Villa Co"]);
    assert.deepEqual(patch.requisites?.map((s) => s.is_default), [true, false]);
    assert.equal(patch.legal_name, "Gem Ltd");
  });
});
