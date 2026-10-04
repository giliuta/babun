import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { alertWords, countedLastDay, outcomeWord, whenWords, type ContactView } from "./contact-journal";

const NOW = new Date(2026, 9, 1, 13, 30);
const view = (hoursAgo: number, patch: Partial<ContactView> = {}): ContactView => ({
  client_id: "c",
  outcome: "open",
  counted: true,
  opened_at: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
  ...patch,
});

describe("журнал открытий номеров (30.09)", () => {
  test("за сутки — только засчитанные и только последние 24 часа", () => {
    const views = [view(1), view(5), view(23), view(25), view(2, { counted: false, outcome: "limit" })];
    assert.equal(countedLastDay(views, NOW), 3);
  });

  test("когда — сегодня, вчера, дата", () => {
    assert.equal(whenWords(new Date(2026, 9, 1, 9, 5).toISOString(), NOW), "сегодня 09:05");
    assert.equal(whenWords(new Date(2026, 8, 30, 23, 59).toISOString(), NOW), "вчера 23:59");
    assert.equal(whenWords(new Date(2026, 8, 28, 14, 2).toISOString(), NOW), "28 сен 14:02");
  });

  test("исход словами; открытый номер — без слова", () => {
    assert.equal(outcomeWord("open"), null);
    assert.equal(outcomeWord("limit"), "сверх лимита");
    assert.equal(outcomeWord("day"), "не в день записи");
  });

  test("тревога словами, с падежом", () => {
    assert.equal(alertWords({ kind: "spike", clients_count: 16, created_at: "" }), "16 номеров за час");
    assert.equal(alertWords({ kind: "spike", clients_count: 21, created_at: "" }), "21 номер за час");
    assert.equal(alertWords({ kind: "spike", clients_count: 22, created_at: "" }), "22 номера за час");
    assert.equal(alertWords({ kind: "limit", clients_count: 30, created_at: "" }), "Упёрся в лимит 30 в сутки");
  });
});
