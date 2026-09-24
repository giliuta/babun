import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient } from "../clients";
import {
  clientMemberOf,
  clientPeople,
  clientsById,
  linkLine,
  residentsOf,
} from "./client-links";

// Сторожа связей (STORY-086). Каждый держит РЕШЕНИЕ, а не реализацию:
// связь без места законна, связь без карточки не строка, нескольких членств
// одна строка не вмещает. Числа и слова здесь — те же, что владелец видит на
// экране: «жилец · Наталья · Вилла 5».

function client(
  id: string,
  patch: Parameters<typeof createBlankClient>[0] = {},
) {
  return createBlankClient({ id, ...patch });
}

const villa5 = {
  id: "loc-villa-5",
  label: "Вилла 5",
  address: "Coral Bay 5",
  isPrimary: true,
};
const villa7 = {
  id: "loc-villa-7",
  label: "Вилла 7",
  address: "Coral Bay 7",
  isPrimary: false,
};

/** Карточка-группа: управляющая с двумя виллами. */
const natalia = client("natalia", {
  full_name: "Наталья",
  locations: [villa5, villa7],
});

/** Вторая группа — чтобы «люди карточки» не хватали чужих. */
const pavel = client("pavel", { full_name: "Павел Иванов" });

describe("clientPeople", () => {
  const ivan = client("ivan", {
    full_name: "Иван Петров",
    memberships: [
      { group_id: "natalia", role: "жилец", location_id: "loc-villa-5" },
    ],
  });
  const katya = client("katya", {
    full_name: "Екатерина",
    memberships: [{ group_id: "pavel", role: "жена", location_id: null }],
  });
  const stranger = client("stranger", { full_name: "Мимо" });

  test("берёт только тех, у кого связь с ЭТОЙ карточкой", () => {
    assert.deepEqual(
      clientPeople([ivan, katya, stranger], "natalia").map((c) => c.id),
      ["ivan"],
    );
    assert.deepEqual(
      clientPeople([ivan, katya, stranger], "pavel").map((c) => c.id),
      ["katya"],
    );
  });

  test("порядок входа сохраняется, пустой id никого не берёт", () => {
    assert.deepEqual(
      clientPeople([katya, ivan], "natalia").map((c) => c.id),
      ["ivan"],
    );
    assert.deepEqual(clientPeople([ivan, katya], ""), []);
  });
});

describe("residentsOf", () => {
  // Жилец ДВУХ вилл одной управляющей — законная пара связей (сервер
  // дедуплицирует по (group_id, location_id), а не по group_id).
  const ivan = client("ivan", {
    full_name: "Иван Петров",
    memberships: [
      { group_id: "natalia", role: "жилец", location_id: "loc-villa-5" },
      { group_id: "natalia", role: "жилец", location_id: "loc-villa-7" },
    ],
  });
  // Управляющая входит в ту же карточку, но не живёт ни на одной вилле.
  const olga = client("olga", {
    full_name: "Ольга",
    memberships: [{ group_id: "natalia", role: "управляющая" }],
  });

  test("жилец двух вилл стоит под каждой", () => {
    assert.deepEqual(
      residentsOf([ivan, olga], "natalia", "loc-villa-5").map((c) => c.id),
      ["ivan"],
    );
    assert.deepEqual(
      residentsOf([ivan, olga], "natalia", "loc-villa-7").map((c) => c.id),
      ["ivan"],
    );
  });

  test("связь без места жильцом не делает", () => {
    assert.deepEqual(
      residentsOf([olga], "natalia", "loc-villa-5").map((c) => c.id),
      [],
    );
  });

  test("место чужой карточки не считается", () => {
    const guest = client("guest", {
      memberships: [
        { group_id: "pavel", role: "жилец", location_id: "loc-villa-5" },
      ],
    });
    assert.deepEqual(
      residentsOf([guest], "natalia", "loc-villa-5").map((c) => c.id),
      [],
    );
  });
});

describe("clientMemberOf", () => {
  const byId = clientsById([natalia, pavel]);

  test("разбирает связь до карточки и места", () => {
    const ivan = client("ivan", {
      memberships: [
        { group_id: "natalia", role: " жилец ", location_id: "loc-villa-5" },
      ],
    });
    const [entry] = clientMemberOf(ivan, byId);
    assert.equal(entry?.groupId, "natalia");
    assert.equal(entry?.role, "жилец");
    assert.equal(entry?.group?.full_name, "Наталья");
    assert.equal(entry?.location?.label, "Вилла 5");
  });

  test("связь на исчезнувшую карточку остаётся, но без имени", () => {
    const orphan = client("orphan", {
      memberships: [{ group_id: "gone", role: "жилец" }],
    });
    const entries = clientMemberOf(orphan, byId);
    assert.equal(entries.length, 1, "связь не выбрасывается");
    assert.equal(entries[0]?.group, null);
    assert.equal(entries[0]?.location, null);
  });

  test("исчезнувшее место гасит только место, связь жива", () => {
    const ivan = client("ivan", {
      memberships: [
        { group_id: "natalia", role: "жилец", location_id: "loc-erased" },
      ],
    });
    const [entry] = clientMemberOf(ivan, byId);
    assert.equal(entry?.group?.full_name, "Наталья");
    assert.equal(entry?.location, null);
    assert.equal(entry?.locationId, "loc-erased", "id места не теряется");
  });

  test("порядок связей — порядок массива", () => {
    const both = client("both", {
      memberships: [
        { group_id: "pavel", role: "жена" },
        { group_id: "natalia", role: "жилец" },
      ],
    });
    assert.deepEqual(
      clientMemberOf(both, byId).map((e) => e.groupId),
      ["pavel", "natalia"],
    );
  });
});

describe("linkLine", () => {
  const byId = clientsById([natalia, pavel]);
  const lineOf = (patch: Parameters<typeof createBlankClient>[0]) =>
    linkLine(clientMemberOf(client("member", patch), byId));

  test("роль · чей · место", () => {
    const line = lineOf({
      memberships: [
        { group_id: "natalia", role: "жилец", location_id: "loc-villa-5" },
      ],
    });
    assert.equal(line?.text, "жилец · Наталья · Вилла 5");
    assert.equal(line?.rest, 0, "одна связь — хвоста нет");
    assert.deepEqual(
      [line?.role, line?.name, line?.place],
      ["жилец", "Наталья", "Вилла 5"],
      "MemberOfLine красит части врозь — они приезжают разобранными",
    );
  });

  test("пустая роль законна — строка начинается с имени", () => {
    const line = lineOf({
      memberships: [
        { group_id: "natalia", role: "", location_id: "loc-villa-5" },
      ],
    });
    assert.equal(line?.text, "Наталья · Вилла 5");
    assert.equal(line?.role, "");
  });

  test("связь без места — только роль и чей", () => {
    const line = lineOf({
      memberships: [{ group_id: "natalia", role: "управляющая" }],
    });
    assert.equal(line?.text, "управляющая · Наталья");
    assert.equal(line?.place, "");
  });

  test("исчезнувшее место читается как связь без места", () => {
    const line = lineOf({
      memberships: [
        { group_id: "natalia", role: "жилец", location_id: "loc-erased" },
      ],
    });
    assert.equal(line?.text, "жилец · Наталья");
  });

  test("связь на исчезнувшую карточку строкой не становится", () => {
    assert.equal(
      lineOf({ memberships: [{ group_id: "gone", role: "жилец" }] }),
      null,
      "«жилец · (никого)» — запрещённое состояние «видно, но пусто»",
    );
  });

  test("безымянная карточка тоже не строка", () => {
    const nameless = clientsById([client("nameless", { full_name: "  " })]);
    assert.equal(
      linkLine(
        clientMemberOf(
          client("member", {
            memberships: [{ group_id: "nameless", role: "жилец" }],
          }),
          nameless,
        ),
      ),
      null,
    );
  });

  test("два членства — первое и хвост « +N»", () => {
    const line = lineOf({
      memberships: [
        { group_id: "pavel", role: "жена" },
        { group_id: "natalia", role: "жилец", location_id: "loc-villa-5" },
      ],
    });
    assert.equal(line?.text, "жена · Павел Иванов +1");
    assert.equal(line?.rest, 1);
  });

  test("жилец двух вилл одной группы — тоже два членства", () => {
    const line = lineOf({
      memberships: [
        { group_id: "natalia", role: "жилец", location_id: "loc-villa-5" },
        { group_id: "natalia", role: "жилец", location_id: "loc-villa-7" },
      ],
    });
    assert.equal(line?.text, "жилец · Наталья · Вилла 5 +1");
  });

  test("хвост считает только названные связи", () => {
    const line = lineOf({
      memberships: [
        { group_id: "natalia", role: "жилец" },
        { group_id: "gone", role: "жилец" },
      ],
    });
    assert.equal(line?.text, "жилец · Наталья", "безымянная связь не хвост");
    assert.equal(line?.rest, 0);
  });

  test("строка берётся первой НАЗВАННОЙ связью", () => {
    const line = lineOf({
      memberships: [
        { group_id: "gone", role: "жилец" },
        { group_id: "pavel", role: "жена" },
      ],
    });
    assert.equal(line?.text, "жена · Павел Иванов");
  });

  test("одна связь через linkLine([entry]) — тот же построитель без хвоста", () => {
    const entries = clientMemberOf(
      client("member", {
        memberships: [
          { group_id: "pavel", role: "жена" },
          { group_id: "natalia", role: "жилец", location_id: "loc-villa-7" },
        ],
      }),
      byId,
    );
    assert.deepEqual(
      entries.map((e) => linkLine([e])?.text),
      ["жена · Павел Иванов", "жилец · Наталья · Вилла 7"],
      "MemberOfLine ×N рисует каждую связь без « +N»",
    );
  });

  test("безымянный объект всё равно называется — молчание значит «место исчезло»", () => {
    const blank = clientsById([
      client("group", {
        full_name: "Наталья",
        locations: [{ id: "loc-blank", label: "  ", address: "  ", isPrimary: true }],
      }),
    ]);
    assert.equal(
      linkLine(
        clientMemberOf(
          client("member", {
            memberships: [
              { group_id: "group", role: "жилец", location_id: "loc-blank" },
            ],
          }),
          blank,
        ),
      )?.text,
      "жилец · Наталья · Объект",
    );
  });
});

// МЕСТО БЕЗ ТИПА — ПЕРВОЙ ЧАСТЬЮ АДРЕСА (прогон 22.09): полный адрес в строке
// человека обрезался и выдавливал роль.
describe("имя места без типа", () => {
  test("безымянный объект зовётся первой частью адреса", () => {
    const bare = { id: "loc-bare", label: "", address: "Villa 5, Agiou Tychona, Limassol", isPrimary: true };
    const group = client("g", { full_name: "Проверка", locations: [bare] });
    const ilya = client("ilya", {
      full_name: "Илья",
      memberships: [{ group_id: "g", role: "жилец", location_id: "loc-bare" }],
    });
    const line = linkLine(clientMemberOf(ilya, clientsById([group, ilya])));
    assert.equal(line?.place, "Villa 5");
  });
  test("объект с типом зовётся типом, как раньше", () => {
    const ivan = client("ivan2", {
      full_name: "Иван",
      memberships: [{ group_id: "natalia", role: "жилец", location_id: "loc-villa-5" }],
    });
    assert.equal(linkLine(clientMemberOf(ivan, clientsById([natalia, ivan])))?.place, "Вилла 5");
  });
});
