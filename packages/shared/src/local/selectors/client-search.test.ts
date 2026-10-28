import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient, type Client } from "../clients";
import { clientSearchRank, matchesClient, rankClientMatches } from "./client-search";

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
        isPrimary: true,
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

  test("«00» в начале номера — то же, что «+» (прогон 03.10)", () => {
    assert.equal(matchesClient(item, "0035799123456"), true);
    assert.equal(matchesClient(item, "00357 99 123 456"), true);
    // Короткий запрос с нулями не теряет нули: «0099» — не «99».
    assert.equal(matchesClient(client("c-0", { full_name: "Б", phone: "+357 99 000 111" }), "0099"), false);
  });

  test("keeps phone matching punctuation-independent", () => {
    assert.equal(matchesClient(item, "99123456"), true);
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

// ЖИЛЬЦЫ НАХОДЯТСЯ ПО ИМЕНИ УПРАВЛЯЮЩЕЙ. Слова связи —
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

describe("поиск промахивался (аудит 03.10)", () => {
  test("греческое ударение — та же буква", () => {
    const giannis = client("gr-1", { full_name: "Γιάννης Παπαδόπουλος" });
    for (const q of ["Γιαννης", "ΓΙΑΝΝΗΣ", "Γιάννης", "giannis", "Παπαδοπουλος"]) {
      assert.equal(matchesClient(giannis, q), true, q);
    }
  });

  test("латиница с диакритикой", () => {
    assert.equal(matchesClient(client("lat-1", { full_name: "José Müller" }), "jose muller"), true);
  });

  test("слова по отдельности, в любом порядке", () => {
    const sidorov = client("w-1", { full_name: "Иван Петрович Сидоров" });
    assert.equal(matchesClient(sidorov, "Иван Сидоров"), true);
    const petrov = client("w-2", { full_name: "Иван Петров", city: "Лимассол" });
    assert.equal(matchesClient(petrov, "Петров Иван"), true);
    assert.equal(matchesClient(petrov, "Иван Лимассол"), true);
    assert.equal(matchesClient(petrov, "Иван Козлов"), false);
  });

  test("номер, показанный с кодом страны, находит клиента с номером без кода", () => {
    const csv = client("e164-1", { phone: "99 123 456", phone_e164: "+35799123456" });
    assert.equal(matchesClient(csv, "+357 99 123 456"), true);
    assert.equal(matchesClient(csv, "99123456"), true);
  });
});

describe("порядок найденного — сначала по имени", () => {
  const byLabel = client("a", { full_name: "Тшлшщ", city: "Test" });
  const exact = client("b", { full_name: "Тест Календарь" });
  const inside = client("c", { full_name: "Анна Тестова" });
  const byPhone = client("d", { full_name: "Ольга", phone: "+357 99 000 001" });

  test("имя с начала — выше совпадения внутри имени, а то — выше метки", () => {
    assert.equal(clientSearchRank(exact, "Тест"), 0);
    assert.equal(clientSearchRank(inside, "Тест"), 1);
    assert.equal(clientSearchRank(byLabel, "Тест"), 2);
    assert.deepEqual(
      rankClientMatches([byLabel, inside, exact], "Тест").map((c) => c.id),
      ["b", "c", "a"],
    );
  });

  test("номер — первой ступенью; слова имени в любом порядке — второй", () => {
    assert.equal(clientSearchRank(byPhone, "99000"), 0);
    assert.equal(clientSearchRank(exact, "Календарь Тест"), 1);
  });

  test("внутри ступени порядок сохраняется; пустой запрос не трогает список", () => {
    const a1 = client("x", { full_name: "Тест 1" });
    const a2 = client("y", { full_name: "Тест 2" });
    assert.deepEqual(rankClientMatches([a2, a1], "тест").map((c) => c.id), ["y", "x"]);
    assert.deepEqual(rankClientMatches([byLabel, exact], " ").map((c) => c.id), ["a", "b"]);
  });
});

describe("буквы без разложения", () => {
  test("украинская «і» и турецкая «ı» находятся латиницей", () => {
    assert.equal(matchesClient(client("ua", { full_name: "Олексій Коваль" }), "Oleksii"), true);
    assert.equal(matchesClient(client("tr", { full_name: "Ayşe Işık" }), "isik"), true);
    assert.equal(matchesClient(client("tr", { full_name: "Ayşe Işık" }), "Işık"), true);
  });
});

describe("номер в местном формате с ведущим 0", () => {
  // В базе номер хранится с кодом страны, а набирают его так, как диктуют:
  // «07700 900123» (Британия), «067 123 4567» (Украина). Без нуля это хвост
  // международного номера.
  const uk = client("uk", { full_name: "John", phone: "+44 7700 900123", phone_e164: "+447700900123" });
  const ua = client("ua", { full_name: "Олег", phone: "+380 67 123 4567", phone_e164: "+380671234567" });
  const de = client("de", { full_name: "Hans", phone: "+49 151 23456789", phone_e164: "+4915123456789" });

  test("местный номер находит клиента", () => {
    assert.equal(matchesClient(uk, "07700 900123"), true);
    assert.equal(matchesClient(ua, "067 123 4567"), true);
    assert.equal(matchesClient(ua, "0671234567"), true);
    assert.equal(matchesClient(de, "0151 23456789"), true);
  });

  test("ноль не превращает чужой номер в совпадение", () => {
    // Хвост — значит конец номера: «0» + цифры из середины не находят.
    assert.equal(matchesClient(uk, "077009001"), false);
    // Короткий запрос с нулём ищется как раньше — подстрокой как есть.
    assert.equal(matchesClient(ua, "06712"), true);
    assert.equal(matchesClient(uk, "0123"), true);
  });

  test("прежние совпадения на месте", () => {
    assert.equal(matchesClient(ua, "671234567"), true);
    assert.equal(matchesClient(ua, "+380671234567"), true);
  });
});

describe("греческое, русское и латинское написание одного имени", () => {
  const pairs: [string, string][] = [
    ["Παπαδοπούλου", "Papadopoulou"],
    ["Λουκάς", "Loukas"],
    ["Μιχάλης", "Michalis"],
    ["Χρίστος", "Christos"],
    ["Κωνσταντίνου", "Constantinou"],
    ["Φώτης", "Photis"],
    ["Андрей", "Andrey"],
    ["Сергей", "Sergey"],
    ["Михаил", "Mikhail"],
    ["Алексей", "Alexey"],
    ["Чехов", "Chekhov"],
  ];
  for (const [a, b] of pairs) {
    test(`${a} ↔ ${b}`, () => {
      assert.equal(matchesClient(client(`x-${a}`, { full_name: a }), b), true, `${b} → ${a}`);
      assert.equal(matchesClient(client(`y-${b}`, { full_name: b }), a), true, `${a} → ${b}`);
    });
  }
  test("разные имена не склеиваются", () => {
    assert.equal(matchesClient(client("m", { full_name: "Мария" }), "Николай"), false);
    assert.equal(matchesClient(client("e", { full_name: "Elena" }), "Andreas"), false);
  });
});

describe("поиск: знаки, цифры адреса, транслит, код страны", () => {
  const c = (id: string, patch: Partial<Client>) => createBlankClient({ id, full_name: "Тест", ...patch });
  test("запрос из одного «+» или «(» не опустошает список", () => {
    assert.equal(matchesClient(c("a", {}), "+"), true);
    assert.equal(matchesClient(c("a", {}), "("), true);
    assert.equal(rankClientMatches([c("a", {}), c("b", {})], "+").length, 2);
  });
  test("«Makarios 8020» не ловит чужой номер с 8020", () => {
    const street = c("s", { address: "Makarios 8020" });
    const phoneOnly = c("p", { phone: "+357 99 808 020" });
    assert.equal(matchesClient(street, "Makarios 8020"), true);
    assert.equal(matchesClient(phoneOnly, "Makarios 8020"), false);
  });
  test("транслит — по имени и адресу, не по заметкам", () => {
    assert.equal(matchesClient(c("n", { full_name: "Ivan" }), "Иван"), true);
    assert.equal(matchesClient(c("a", { address: "Makariou" }), "Макариу"), true);
    const note = c("x", { full_name: "Пётр", notes: [{ id: "1", text: "Ivan", created_at: "2026-01-01" }] });
    assert.equal(matchesClient(note, "Иван"), false);
    assert.equal(matchesClient(note, "Ivan"), true);
  });
  test("номер с кодом страны находит доп. номер без кода", () => {
    const extra = c("e", { phones: [{ id: "p1", number: "99 123 456", label: "", name: "" }] });
    assert.equal(matchesClient(extra, "+357 99 123 456"), true);
    assert.equal(matchesClient(extra, "+357 99 123 457"), false);
  });
});
