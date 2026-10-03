import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessLevel, MemberAccessMap } from "@/features/access/access-map";
import { bookRights, calendarActions, eventBlocks, readOnlyBookRights, recordBlocks } from "./record-blocks";

const TEAM = "team-1";

/** Реестр как на боевой базе после STORY-088 (волна 1, 24.09): блоки записи и
 *  действия календаря живые, «Время записи» слито с переносом и не живое. */
const REGISTRY: { key: string; live: boolean; levels: AccessLevel[] }[] = [
  { key: "calendar.create", live: true, levels: ["off", "write"] },
  { key: "calendar.move", live: true, levels: ["off", "write"] },
  { key: "calendar.cancel", live: true, levels: ["off", "write"] },
  { key: "calendar.records", live: true, levels: ["off", "read", "write"] },
  { key: "calendar.events", live: true, levels: ["off", "read", "write"] },
  { key: "calendar.day_labels", live: true, levels: ["off", "read", "write"] },
  { key: "calendar.schedule", live: true, levels: ["off", "read", "write"] },
  { key: "record.team", live: true, levels: ["read", "write"] },
  { key: "record.label", live: true, levels: ["off", "read", "write"] },
  { key: "record.when", live: false, levels: ["off", "read", "write"] },
  { key: "record.client", live: true, levels: ["off", "read", "write"] },
  { key: "record.object", live: true, levels: ["off", "read", "write"] },
  { key: "record.services", live: true, levels: ["off", "read"] },
  { key: "record.amount", live: true, levels: ["off", "read", "write"] },
  { key: "record.payment", live: true, levels: ["off", "read", "write"] },
  { key: "record.files", live: true, levels: ["off", "read", "write"] },
  { key: "record.status", live: true, levels: ["read", "write"] },
  { key: "record.color", live: true, levels: ["off", "write"] },
];

function map(levels: Record<string, AccessLevel>): MemberAccessMap {
  return {
    tenantId: "tenant-1",
    isOwner: false,
    version: 1,
    company: {},
    calendars: { [TEAM]: levels },
    attachedCalendars: [TEAM],
  };
}

/** Dmitry на боевой 24.09 после засева. */
const DMITRY = map({
  // Записи команды видит — так их засевает сервер при приёме приглашения.
  "calendar.records": "read",
  "calendar.create": "write",
  "calendar.events": "read",
  "calendar.day_labels": "write",
  "calendar.schedule": "read",
  "record.object": "read",
  "record.services": "read",
  "record.amount": "read",
  "record.payment": "write",
  "record.files": "write",
  "record.status": "write",
});

const at = (levels: MemberAccessMap, teamId: string | null = TEAM) =>
  ({ role: "master", map: levels, registry: REGISTRY, teamId }) as const;

describe("страница записи — одна для всех, блоки по правам", () => {
  test("владелец меняет всё и ничего не ждёт", () => {
    const blocks = recordBlocks({ role: "owner", map: undefined, registry: undefined, teamId: null });
    assert.ok(Object.values(blocks).every((level) => level === "write"));
    const actions = calendarActions({ role: "owner", map: undefined, registry: undefined, teamId: null });
    assert.deepEqual(actions, {
      create: true,
      move: true,
      cancel: true,
      color: true,
      status: true,
      records: "write",
      events: "write",
      dayLabels: "write",
      schedule: "write",
    });
  });

  test("мастер получает положения своего календаря; нет строки — умолчание реестра", () => {
    assert.deepEqual(recordBlocks(at(DMITRY)), {
      // «Команда и мастер» по умолчанию «Видит»: чья запись — видно всегда.
      team: "read",
      label: "hidden",
      when: "read",
      client: "hidden",
      object: "read",
      services: "read",
      amount: "read",
      payment: "write",
      files: "write",
      status: "write",
      note: "write",
      color: "read",
    });
  });

  test("«Меняет» у клиента, объекта, суммы, метки, команды и цвета открывает правку", () => {
    const blocks = recordBlocks(
      at(
        map({
          ...DMITRY.calendars[TEAM],
          "record.client": "write",
          "record.object": "write",
          "record.amount": "write",
          "record.label": "write",
          "record.team": "write",
          "record.color": "write",
          "calendar.move": "write",
        }),
      ),
    );
    for (const key of ["client", "object", "amount", "services", "label", "team", "color", "when"] as const) {
      assert.equal(blocks[key], "write", key);
    }
  });

  test("услуги правит «Сумма: Меняет», но скрытые услуги она не открывает", () => {
    const hidden = recordBlocks(at(map({ "record.amount": "write", "record.services": "off" })));
    assert.equal(hidden.services, "hidden");
    assert.equal(hidden.amount, "write");
    const readOnly = recordBlocks(at(map({ "record.amount": "read", "record.services": "read" })));
    assert.equal(readOnly.services, "read");
  });

  test("закрытый блок исчезает; заметку без статуса только читают", () => {
    const blocks = recordBlocks(at(map({ "record.amount": "off", "record.status": "read" })));
    assert.equal(blocks.amount, "hidden");
    assert.equal(blocks.client, "hidden", "нет строки — умолчание «Не видит»");
    assert.equal(blocks.status, "read");
    assert.equal(blocks.note, "read");
    assert.equal(blocks.when, "read", "время видно всегда, даже без переноса");
  });

  test("статус не прячется: старое «Не видит» читается как «Видит»", () => {
    const blocks = recordBlocks(at(map({ "record.status": "off" })));
    assert.equal(blocks.status, "read");
    assert.equal(blocks.note, "read");
  });

  test("неживой блок — без правки, даже если в карте «Меняет»", () => {
    const dead = REGISTRY.map((b) => (b.key === "record.client" ? { ...b, live: false } : b));
    const blocks = recordBlocks({ ...at(map({ "record.client": "write" })), registry: dead });
    assert.equal(blocks.client, "read");
    const actions = calendarActions({
      ...at(map({ "calendar.create": "write" })),
      registry: REGISTRY.map((b) => (b.key === "calendar.create" ? { ...b, live: false } : b)),
    });
    assert.equal(actions.create, false, "сервер неживого блока не пустит — кнопки нет");
  });

  test("действия календаря — по своим блокам", () => {
    assert.deepEqual(calendarActions(at(DMITRY)), {
      create: true,
      move: false,
      cancel: false,
      color: false,
      status: true,
      records: "read",
      events: "read",
      dayLabels: "write",
      schedule: "read",
    });
    assert.deepEqual(
      calendarActions(at(map({ "calendar.move": "write", "calendar.cancel": "write", "calendar.events": "write" }))),
      { create: false, move: true, cancel: true, color: false, status: false, records: "hidden", events: "write", dayLabels: "hidden", schedule: "hidden" },
    );
  });

  test("чужой календарь, запись без календаря, едущая карта — ничего", () => {
    const inputs = [
      at(DMITRY, "team-2"),
      at(DMITRY, null),
      { role: "master", map: undefined, registry: REGISTRY, teamId: TEAM } as const,
      { role: "master", map: DMITRY, registry: undefined, teamId: TEAM } as const,
    ];
    for (const input of inputs) {
      assert.ok(Object.values(recordBlocks(input)).every((level) => level === "hidden"));
      const actions = calendarActions(input);
      assert.equal(actions.create || actions.move || actions.cancel || actions.status, false);
      assert.equal(actions.events, "hidden");
    }
  });
});

describe("страница записи — двери по правам", () => {
  const blocks = recordBlocks(at(DMITRY));

  test("владелец жмёт всё", () => {
    const rights = bookRights({ isMember: false, kind: "work", isEdit: true, record: blocks, eventWritable: false });
    assert.ok(Object.values(rights).every(Boolean));
  });

  test("мастер в своей записи — по блокам; новая запись — календарь и время свои", () => {
    const edit = bookRights({ isMember: true, kind: "work", isEdit: true, record: blocks, eventWritable: false });
    assert.equal(edit.editWhen, false, "без «Переносить» время не меняет");
    assert.equal(edit.editTeam, false);
    assert.equal(edit.showClient, false, "клиент скрыт");
    assert.equal(edit.showObject, true);
    assert.equal(edit.editObject, false);
    assert.equal(edit.editServices, false);
    assert.equal(edit.showMoney, true);
    assert.equal(edit.editTotal, false);
    assert.equal(edit.editNote, true, "статус меняет — заметку пишет");
    // Новая запись — целиком его: клиента, объект и услуги выбирает сам,
    // ручную цену — только при «Сумма: Меняет».
    const create = bookRights({ isMember: true, kind: "work", isEdit: false, record: blocks, eventWritable: false });
    assert.equal(create.editWhen && create.editTeam && create.editClient && create.editObject, true);
    assert.equal(create.editServices && create.editNote && create.editColor, true);
    assert.equal(create.editTotal, false);
  });

  test("своё событие при «События: Меняет» — всё, кроме клиента, объекта и календаря", () => {
    const own = bookRights({ isMember: true, kind: "event", isEdit: true, record: blocks, eventWritable: true });
    assert.equal(own.editWhen && own.editNote && own.editColor && own.editLabel && own.editEventType, true);
    assert.equal(own.editClient || own.editObject || own.editTeam, false);
    const foreign = bookRights({ isMember: true, kind: "event", isEdit: true, record: blocks, eventWritable: false });
    assert.equal(foreign.editWhen || foreign.editNote || foreign.editColor, false);
  });
});

// БЛОКИ СОБЫТИЯ И ЗАМЕТКА ЗАПИСИ (владелец 30.09: «внутри записи клиентов и
// внутри события — что может видеть, что не может, что может
// редактировать»). До миграции блоки неживые — страница ведёт себя как было.
describe("блоки события и заметка записи", () => {
  const EVENT_KEYS = ["event.label", "event.type", "event.client", "event.object", "event.note", "event.files"];
  const LIVE: typeof REGISTRY = [
    ...REGISTRY,
    { key: "record.note", live: true, levels: ["off", "read", "write"] },
    ...EVENT_KEYS.map((key) => ({ key, live: true, levels: ["off", "read", "write"] as AccessLevel[] })),
  ];
  const live = (levels: MemberAccessMap) => ({ role: "master", map: levels, registry: LIVE, teamId: TEAM }) as const;

  test("до миграции: всё видно, клиент и объект события — без правки, заметку пишет тот, кто меняет статус", () => {
    const ev = eventBlocks(at(DMITRY));
    assert.deepEqual(ev, { label: "write", type: "write", client: "read", object: "read", note: "write", files: "write" });
    assert.equal(recordBlocks(at(DMITRY)).note, "write");
    assert.equal(recordBlocks(at(map({ "record.status": "read" }))).note, "read");
  });

  test("после миграции: блоки события — по своим правам", () => {
    const ev = eventBlocks(live(map({ "calendar.day_labels": "read", "event.label": "write", "event.type": "read", "event.note": "off" })));
    assert.equal(ev.label, "write");
    assert.equal(ev.type, "read");
    assert.equal(ev.note, "hidden");
    assert.equal(ev.client, "hidden");
  });

  test("заметка записи — своё право: статус меняет, а заметку только читает", () => {
    const rb = recordBlocks(live(map({ "record.status": "write", "record.note": "read" })));
    assert.equal(rb.status, "write");
    assert.equal(rb.note, "read");
    const can = bookRights({ isMember: true, kind: "work", isEdit: true, record: rb, eventWritable: false });
    assert.equal(can.showNote, true);
    assert.equal(can.editNote, false);
    const hidden = recordBlocks(live(map({ "record.note": "off" })));
    assert.equal(bookRights({ isMember: true, kind: "work", isEdit: true, record: hidden, eventWritable: false }).showNote, false);
  });

  test("событие меняет только автор, и только открытый блок", () => {
    const event = eventBlocks(live(map({ "calendar.day_labels": "read", "event.label": "write", "event.client": "read", "event.note": "off" })));
    const rb = recordBlocks(live(map({})));
    const mine = bookRights({ isMember: true, kind: "event", isEdit: true, record: rb, event, eventWritable: true });
    assert.equal(mine.editLabel, true);
    assert.equal(mine.showClient, true);
    assert.equal(mine.editClient, false);
    assert.equal(mine.showNote, false);
    const others = bookRights({ isMember: true, kind: "event", isEdit: true, record: rb, event, eventWritable: false });
    assert.equal(others.editLabel, false);
    assert.equal(others.showLabel, true);
  });
});

describe("метка записи и события — под «Меткой дня» (владелец 30.09)", () => {
  const LIVE_LABELS: typeof REGISTRY = [
    ...REGISTRY,
    { key: "event.label", live: true, levels: ["off", "read", "write"] },
  ];
  const at2 = (levels: MemberAccessMap) => ({ role: "master", map: levels, registry: LIVE_LABELS, teamId: TEAM }) as const;

  test("день скрыт — метки записи и события нет, что бы ни стояло в них", () => {
    const hidden = map({ "record.label": "write", "event.label": "write" });
    assert.equal(recordBlocks(at2(hidden)).label, "hidden");
    assert.equal(eventBlocks(at2(hidden)).label, "hidden");
  });

  test("день открыт — метка записи по своему праву", () => {
    const open = map({ "calendar.day_labels": "read", "record.label": "write", "event.label": "read" });
    assert.equal(recordBlocks(at2(open)).label, "write");
    assert.equal(eventBlocks(at2(open)).label, "read");
  });
});

describe("запись клиента без тарифа (02.10)", () => {
  test("видно всё, что и с тарифом, а ни одна правка не нажимается", () => {
    const owner = bookRights({
      isMember: false,
      kind: "work",
      isEdit: true,
      record: recordBlocks({ role: "owner", map: undefined, registry: undefined, teamId: TEAM }),
      eventWritable: true,
    });
    const frozen = readOnlyBookRights(owner);
    for (const [key, value] of Object.entries(frozen)) {
      if (key.startsWith("edit")) assert.equal(value, false, `${key} должен быть закрыт`);
      else assert.equal(value, owner[key as keyof typeof owner], `${key} — как с тарифом`);
    }
  });
});
