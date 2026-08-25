import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient } from "../clients";
import { findDuplicateCandidates, matchesClient } from "./client-search";

function client(
  id: string,
  patch: Parameters<typeof createBlankClient>[0] = {},
) {
  return createBlankClient({ id, ...patch });
}

describe("matchesClient", () => {
  const item = client("client-1", {
    full_name: "Иван Петров",
    email: "ivan@example.com",
    city: "Лимассол",
    notes: [
      { id: "note-1", text: "Звонить после 18", created_at: "2026-07-20" },
    ],
    phones: [
      { id: "phone-1", number: "+357 99 123 456", label: "Жена", name: "Мария" },
    ],
    locations: [
      {
        id: "location-1",
        label: "Офис",
        address: "Agias Fylaxeos 10",
        note: "Код ворот 42",
        equipment: [
          {
            id: "unit-1",
            room: "Переговорная",
            brand: "Daikin",
            model: "FTXM35",
            ac_type: "split",
            has_indoor: true,
            has_outdoor: true,
          },
        ],
      },
    ],
  });

  test("finds contact, city, notes and equipment details", () => {
    for (const query of [
      "example.com",
      "limassol",
      "после 18",
      "мария",
      "код ворот",
      "daikin",
      "FTXM35",
    ]) {
      assert.equal(matchesClient(item, query), true, query);
    }
  });

  test("keeps phone matching punctuation-independent", () => {
    assert.equal(matchesClient(item, "99123456"), true);
  });
});

describe("findDuplicateCandidates", () => {
  test("does not confuse a name with a city or note", () => {
    const item = client("client-1", {
      full_name: "Иван Петров",
      city: "Лимассол",
      notes: [{ id: "n", text: "Мария", created_at: "2026-07-20" }],
    });
    assert.deepEqual(
      findDuplicateCandidates([item], { full_name: "Лимассол" }),
      [],
    );
    assert.deepEqual(findDuplicateCandidates([item], { full_name: "Мария" }), []);
  });

  test("still matches the normalized client name and phone", () => {
    const item = client("client-1", {
      full_name: "Иван Петров",
      phone: "+357 99 123 456",
    });
    assert.equal(
      findDuplicateCandidates([item], { full_name: "Ivan Petrov" })[0]?.id,
      item.id,
    );
    assert.equal(
      findDuplicateCandidates([item], {
        full_name: "Другой клиент",
        phone: "99 123 456",
      })[0]?.id,
      item.id,
    );
  });
});
