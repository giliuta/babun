import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { localBookingCarry as carry } from "./booking-carry";

const BLOCKS = [
  { id: "team", pinned: true },
  { id: "label" },
  { id: "when", pinned: true },
  { id: "client", pinned: true },
  { id: "object" },
  { id: "services", pinned: true },
  { id: "payment" },
  { id: "note" },
  { id: "files" },
];
const localBookingCarry = (local: string[] | undefined, company: Parameters<typeof carry>[1]) =>
  carry(local, company, BLOCKS);

// STORY-088: блоки записи переехали из телефона в функции компании.
describe("перенос блоков записи с телефона в компанию", () => {
  test("выключенное в телефоне становится выключенной функцией", () => {
    assert.deepEqual(
      localBookingCarry(["team", "when", "client", "services", "payment", "files"], []),
      ["record_label", "objects", "record_note"],
    );
  });

  test("компания уже настроена или в телефоне ничего нет — не трогаем", () => {
    assert.equal(localBookingCarry(["team"], ["debts"]), null);
    assert.equal(localBookingCarry(undefined, []), null);
    assert.equal(
      localBookingCarry(["team", "label", "when", "client", "object", "services", "payment", "note"], []),
      null,
    );
  });
});
