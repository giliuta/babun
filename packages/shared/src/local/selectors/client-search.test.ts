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

// STORY-085: инвойс могут просить на клиента с его реквизитами — клиента
// находят и по юридическому имени, и по номеру VAT.
describe("реквизиты клиента в поиске", () => {
  const company = client("company", {
    full_name: "Gem Capital",
    legal_name: "Gem Capital Holdings Ltd",
    vat_number: "CY10234567X",
  });

  test("клиент находится по юридическому имени и VAT", () => {
    assert.equal(matchesClient(company, "Holdings"), true);
    assert.equal(matchesClient(company, "10234567"), true);
    assert.equal(matchesClient(company, "Ольга"), false);
  });
});

// ЖИЛЬЦЫ НАХОДЯТСЯ ПО ИМЕНИ УПРАВЛЯЮЩЕЙ (владелец 22.09). Слова связи —
// имя карточки-группы, роль, место — приходят снаружи: у самого клиента
// лежит только id карточки.
describe("слова связи в поиске", () => {
  const ivan = { ...createBlankClient(), full_name: "Иван Петров", phone: "+35799000107" };
  test("по имени карточки, роли и месту", () => {
    const words = ["Наталья", "жилец", "Вилла 7"];
    assert.equal(matchesClient(ivan, "натал", words), true);
    assert.equal(matchesClient(ivan, "жилец", words), true);
    assert.equal(matchesClient(ivan, "вилла 7", words), true);
  });
  test("без слов связи чужое имя не находит", () => {
    assert.equal(matchesClient(ivan, "натал"), false);
    assert.equal(matchesClient(ivan, "натал", ["Мария"]), false);
  });
});
