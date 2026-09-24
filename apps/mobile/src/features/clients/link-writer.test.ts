import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBlankClient,
  type Client,
  type ClientMembership,
} from "@babun/shared/local/clients";
import {
  capabilitiesOf,
  memberScope,
  type ClientsScope,
  type CompanyAccess,
} from "./clients-company";

// СТОРОЖА ПИСАТЕЛЯ СВЯЗЕЙ (STORY-086).
//
// Каждый держит РЕШЕНИЕ, за которым стоит конкретная потеря:
//   • патч собирается из свежей строки, а не из кадра — иначе вторая правка
//     затирает первую (дыра 6);
//   • связь без места дозаполняется местом — иначе жена, поселённая в виллу,
//     становится двумя строками;
//   • роль исчезнувшей связи не пишется — иначе коммит на размонтировании
//     воскрешает убранную связь (дыра 7);
//   • очередь одна на процесс — иначе две открытые карточки стирают связи
//     одного человека (дыра 6);
//   • строка встаёт в перечень до ответа сервера и в том ключе, что кормит
//     блок (дыра 5);
//   • блок людей есть целиком или его нет (`caps.links`);
//   • по одному имени сохраняется только клиент со связью (дыра 1).
//
// КАК ПРОВЕРЯЕТСЯ. Писатель и черновик — хуки и тянут `react-native` и
// `expo-router`, которые bun не поднимает. Поэтому их чистые ядра стоят между
// метками, и сторож вырезает ядро копией во временный файл и зовёт его —
// поведение, а не текст. Метку сдвинули или ввезли в ядро значение — сторож
// падает на загрузке, и это правильный отказ: проверять стало нечего.

const here = dirname(fileURLToPath(import.meta.url));
const CORE_BEGIN = "// ─── ЧИСТОЕ ЯДРО: НАЧАЛО";
const CORE_END = "// ─── ЧИСТОЕ ЯДРО: КОНЕЦ";

async function loadCore<T>(file: string): Promise<T> {
  const source = readFileSync(resolve(here, file), "utf8");
  const begin = source.indexOf(CORE_BEGIN);
  const end = source.indexOf(CORE_END);
  assert.ok(begin >= 0 && end > begin, `${file}: метки чистого ядра потеряны`);
  const dir = mkdtempSync(join(tmpdir(), "babun-core-"));
  const copy = join(dir, basename(file).replace(/\.tsx?$/, ".core.ts"));
  writeFileSync(copy, source.slice(begin, end), "utf8");
  try {
    return (await import(pathToFileURL(copy).href)) as T;
  } finally {
    // Модуль уже в памяти; копия на диске не нужна, а хук перед пушем гоняет
    // тесты на каждый коммит — мусор копился бы во временной папке.
    rmSync(dir, { recursive: true, force: true });
  }
}

const WRITER_CORE = [
  "clientMembersQueryKey",
  "linkKeyOf",
  "parseLinkKey",
  "membershipsWithLink",
  "membershipsWithRole",
  "membershipsWithoutLink",
  "linkQueueFor",
  "freshLinks",
  "membersAfterWrite",
] as const;
type WriterCore = Pick<typeof import("./use-link-writer"), (typeof WRITER_CORE)[number]>;

const DRAFT_CORE = ["draftCanSave", "draftPhoneTyped"] as const;
type DraftCore = Pick<typeof import("./useClientDraft"), (typeof DRAFT_CORE)[number]>;

const writer = await loadCore<WriterCore>("use-link-writer.ts");
const draft = await loadCore<DraftCore>("useClientDraft.ts");

const NATALIA = "natalia-0000-0000";
const MARIA = "maria-0000-0000";
const VILLA_5 = "loc-villa-5";
const VILLA_7 = "loc-villa-7";

function link(group_id: string, role: string, location_id: string | null = null): ClientMembership {
  return { group_id, role, location_id };
}

function person(id: string, full_name: string, memberships: ClientMembership[] = []): Client {
  return createBlankClient({ id, full_name, memberships });
}

describe("ядро вырезано целиком", () => {
  test("каждая чистая часть писателя и черновика поднимается копией", () => {
    for (const name of WRITER_CORE) assert.equal(typeof writer[name], "function", name);
    for (const name of DRAFT_CORE) assert.equal(typeof draft[name], "function", name);
  });
});

describe("ключи — договор читателя, писателя и страницы", () => {
  test("людей карточки писатель бьёт ровно в ключ, который кормит блок", () => {
    assert.deepEqual(writer.clientMembersQueryKey("tenant-1", NATALIA), [
      "client-members",
      "tenant-1",
      NATALIA,
    ]);
  });

  test("ключ строки несёт человека, карточку и место — и разбирается обратно", () => {
    for (const locationId of [VILLA_5, null]) {
      const ref = { memberId: "ivan", groupId: NATALIA, locationId };
      assert.deepEqual(writer.parseLinkKey(writer.linkKeyOf(ref)), ref);
    }
  });

  test("связь без места у Натальи и у Марии — две разные строки", () => {
    // Карточка в ключе ради этого случая: иначе писатель угадывал бы группу.
    assert.notEqual(
      writer.linkKeyOf({ memberId: "ivan", groupId: NATALIA, locationId: null }),
      writer.linkKeyOf({ memberId: "ivan", groupId: MARIA, locationId: null }),
    );
  });

  test("чужой ключ не разбирается — писать по нему нельзя", () => {
    for (const key of ["ivan", "ivan|", `|${NATALIA}|`, `ivan||${VILLA_5}`, "a|b|c|d"]) {
      assert.equal(writer.parseLinkKey(key), null, key);
    }
  });
});

describe("патч собирается из свежей строки члена, а не из кадра", () => {
  test("вторая правка подряд видит первую, пока та ещё в пути", () => {
    const queue = writer.linkQueueFor("ivan-two-writes");
    // Строка, какой её держит кадр: Иван — только жилец Натальи.
    const rendered = [link(NATALIA, "жилец", VILLA_5)];

    const first = writer.membershipsWithLink(
      writer.freshLinks(queue, rendered),
      { groupId: MARIA, role: "сосед" },
      "ivan-two-writes",
    );
    assert.ok(first);
    // Запись ушла и ещё не ответила.
    queue.latest = first;
    queue.pending = 1;

    const second = writer.membershipsWithRole(
      writer.freshLinks(queue, rendered),
      { memberId: "ivan-two-writes", groupId: NATALIA, locationId: VILLA_5 },
      "арендатор",
    );
    assert.deepEqual(second, [
      link(NATALIA, "арендатор", VILLA_5),
      link(MARIA, "сосед", null),
    ]);
  });

  test("своих записей в пути нет — правда у строки, в том числе чужая правка", () => {
    const queue = writer.linkQueueFor("ivan-settled");
    queue.latest = [link(NATALIA, "жилец", VILLA_5)];
    queue.pending = 0;
    const fromServer = [link(NATALIA, "жилец", VILLA_5), link(MARIA, "жилец", null)];
    assert.deepEqual(writer.freshLinks(queue, fromServer), fromServer);
  });
});

describe("связь без места дозаполняется местом, а не дублируется", () => {
  test("жена, которую поселили в Виллу 5, — одна связь, и роль её не переписана", () => {
    assert.deepEqual(
      writer.membershipsWithLink(
        [link(NATALIA, "жена")],
        { groupId: NATALIA, role: "жилец", locationId: VILLA_5 },
        "katya",
      ),
      [link(NATALIA, "жена", VILLA_5)],
    );
  });

  test("пустую роль дверь заполняет своим словом", () => {
    assert.deepEqual(
      writer.membershipsWithLink(
        [link(NATALIA, "")],
        { groupId: NATALIA, role: "жилец", locationId: VILLA_5 },
        "ivan",
      ),
      [link(NATALIA, "жилец", VILLA_5)],
    );
  });

  test("жилец двух вилл одной управляющей — две связи", () => {
    assert.deepEqual(
      writer.membershipsWithLink(
        [link(NATALIA, "жилец", VILLA_7)],
        { groupId: NATALIA, role: "жилец", locationId: VILLA_5 },
        "ivan",
      ),
      [link(NATALIA, "жилец", VILLA_7), link(NATALIA, "жилец", VILLA_5)],
    );
  });

  test("та же связь ещё раз и связь с самим собой — писать нечего", () => {
    assert.equal(
      writer.membershipsWithLink(
        [link(NATALIA, "жилец", VILLA_5)],
        { groupId: NATALIA, role: "жилец", locationId: VILLA_5 },
        "ivan",
      ),
      null,
    );
    assert.equal(writer.membershipsWithLink([], { groupId: "ivan", role: "" }, "ivan"), null);
  });

  test("связи других карточек переживают запись, форма у всех одна", () => {
    const legacy = { group_id: MARIA, role: "сосед" } as ClientMembership;
    assert.deepEqual(
      writer.membershipsWithLink([legacy], { groupId: NATALIA, role: " жилец " }, "ivan"),
      [link(MARIA, "сосед", null), link(NATALIA, "жилец", null)],
    );
  });
});

describe("роль исчезнувшей связи не пишется", () => {
  const ivan = { memberId: "ivan", groupId: NATALIA, locationId: VILLA_5 };

  test("связь убрали — поздний коммит роли не пишет ничего", () => {
    assert.equal(writer.membershipsWithRole([link(MARIA, "сосед")], ivan, "жилец"), null);
    assert.equal(writer.membershipsWithRole([], ivan, "жилец"), null);
    // Та же карточка, но другое место — это другая связь.
    assert.equal(
      writer.membershipsWithRole([link(NATALIA, "жилец", VILLA_7)], ivan, "сосед"),
      null,
    );
  });

  test("роль та же — писать нечего; другая — правится только эта связь", () => {
    const prev = [link(NATALIA, "жилец", VILLA_5), link(MARIA, "сосед")];
    assert.equal(writer.membershipsWithRole(prev, ivan, " жилец "), null);
    assert.deepEqual(writer.membershipsWithRole(prev, ivan, "арендатор"), [
      link(NATALIA, "арендатор", VILLA_5),
      link(MARIA, "сосед"),
    ]);
  });

  test("«Убрать» снимает ровно одну связь, повтор — ничего", () => {
    const prev = [link(NATALIA, "жилец", VILLA_5), link(NATALIA, "жилец", VILLA_7)];
    assert.deepEqual(writer.membershipsWithoutLink(prev, ivan), [
      link(NATALIA, "жилец", VILLA_7),
    ]);
    assert.equal(writer.membershipsWithoutLink([link(NATALIA, "жилец", VILLA_7)], ivan), null);
  });
});

describe("очередь писателя одна на процесс", () => {
  test("один человек с двух карточек — одна очередь и одна свежая правда", () => {
    const fromNatalia = writer.linkQueueFor("ivan-two-cards");
    const fromMaria = writer.linkQueueFor("ivan-two-cards");
    assert.equal(fromNatalia, fromMaria);
    fromNatalia.pending = 1;
    fromNatalia.latest = [link(NATALIA, "жилец", VILLA_5)];
    assert.deepEqual(writer.freshLinks(fromMaria, []), [link(NATALIA, "жилец", VILLA_5)]);
  });

  test("у разных людей очереди разные — чужая запись не держит свою", () => {
    assert.notEqual(writer.linkQueueFor("ivan-own"), writer.linkQueueFor("maria-own"));
  });
});

describe("строка встаёт и уходит до ответа сервера", () => {
  const anna = person("anna", "Анна", [link(NATALIA, "жилец", VILLA_7)]);
  const yuri = person("yuri", "Юрий", [link(NATALIA, "жилец", VILLA_7)]);

  test("новый жилец встаёт в перечень группы по порядку имён", () => {
    const ivan = person("ivan", "Иван");
    const next = [link(NATALIA, "жилец", VILLA_5)];
    const rows = writer.membersAfterWrite([anna, yuri], ivan, next, NATALIA);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["anna", "ivan", "yuri"],
    );
    assert.deepEqual(rows[1]?.memberships, next);
  });

  test("последнюю связь с группой убрали — строки нет", () => {
    assert.deepEqual(
      writer.membersAfterWrite([anna, yuri], anna, [], NATALIA).map((row) => row.id),
      ["yuri"],
    );
  });

  test("откат записи Ивана возвращает ЕГО строку, а добавленных после — не трогает", () => {
    // Так писатель откатывает неудачную запись: тем же построителем, от
    // `base` — а не снимком перечня, в котором Юрия ещё не было.
    const ivan = person("ivan", "Иван");
    const added = writer.membersAfterWrite([anna], ivan, [link(NATALIA, "жилец", VILLA_5)], NATALIA);
    const withYuri = writer.membersAfterWrite(added, yuri, yuri.memberships ?? [], NATALIA);
    assert.deepEqual(
      writer.membersAfterWrite(withYuri, ivan, [], NATALIA).map((row) => row.id),
      ["anna", "yuri"],
    );
  });

  test("переселение трогает обе группы одной записью, чужую — не трогает", () => {
    const ivan = person("ivan", "Иван", [link(NATALIA, "жилец", VILLA_5)]);
    const moved = [link(MARIA, "жилец", null)];
    const nataliaRows = [anna, ivan];
    const mariaRows: Client[] = [];
    const strangerRows = [yuri];
    assert.deepEqual(
      writer.membersAfterWrite(nataliaRows, ivan, moved, NATALIA).map((row) => row.id),
      ["anna"],
    );
    assert.deepEqual(
      writer.membersAfterWrite(mariaRows, ivan, moved, MARIA).map((row) => row.id),
      ["ivan"],
    );
    // Тот же массив — писатель по нему понимает, что этот ключ не тронут.
    assert.equal(writer.membersAfterWrite(strangerRows, ivan, moved, "pavel"), strangerRows);
  });
});

describe("блок людей есть целиком или его нет", () => {
  const TENANT = "11365a87-bef9-4f6c-a030-b15083fe646b";
  const names = new Map([[TENANT, "Giliuta"]]);
  const access = (over: Partial<CompanyAccess>): CompanyAccess => ({
    isOwner: false,
    clients: "write",
    scope: "all",
    contacts: "read",
    ...over,
  });
  const member = (over: Partial<CompanyAccess>) =>
    capabilitiesOf(memberScope(TENANT, "master", access(over), names, TENANT) as ClientsScope);

  test("своя база — люди видны", () => {
    const own: ClientsScope = {
      tenantId: TENANT,
      tenantName: "Giliuta",
      kind: "own",
      role: "owner",
      level: "write",
      contacts: true,
      everyClient: true,
      isActive: true,
    };
    assert.equal(capabilitiesOf(own).links, true);
  });

  test("сотрудник со всеми клиентами и телефонами — видны", () => {
    assert.equal(member({}).links, true);
  });

  test("набор урезан или телефоны скрыты — блока нет", () => {
    assert.equal(member({ scope: "own" }).links, false);
    assert.equal(member({ contacts: "off" }).links, false);
  });

  test("клиент записи — блока нет: окно мастера связей не отдаёт", () => {
    const record: ClientsScope = {
      tenantId: TENANT,
      tenantName: "Giliuta",
      kind: "record",
      role: "master",
      level: "read",
      contacts: true,
      everyClient: false,
      isActive: true,
    };
    assert.equal(capabilitiesOf(record).links, false);
  });
});

describe("по одному имени сохраняется только клиент со связью", () => {
  const gate = (over: Partial<Parameters<DraftCore["draftCanSave"]>[0]>) =>
    draft.draftCanSave({
      active: true,
      nameFilled: true,
      e164: null,
      phoneTyped: false,
      linked: false,
      duplicate: false,
      saving: false,
      ...over,
    });

  test("без связи закон «нужен номер» стоит", () => {
    assert.equal(gate({}), false);
    assert.equal(gate({ e164: "+35799123456", phoneTyped: true }), true);
  });

  test("жилец без номера — по одному имени", () => {
    assert.equal(gate({ linked: true }), true);
  });

  test("начатый, но не разобранный номер не пропускает и связь", () => {
    assert.equal(gate({ linked: true, phoneTyped: true }), false);
  });

  test("имя, дубль и идущее создание гасят кнопку и со связью", () => {
    assert.equal(gate({ linked: true, nameFilled: false }), false);
    assert.equal(gate({ linked: true, duplicate: true, e164: "+35799123456" }), false);
    assert.equal(gate({ linked: true, saving: true }), false);
    assert.equal(gate({ linked: true, active: false }), false);
  });

  test("код страны в поле номером не считается", () => {
    assert.equal(draft.draftPhoneTyped("+357 ", "+357"), false);
    assert.equal(draft.draftPhoneTyped("   ", "+357"), false);
    assert.equal(draft.draftPhoneTyped("+357 99", "+357"), true);
  });
});
