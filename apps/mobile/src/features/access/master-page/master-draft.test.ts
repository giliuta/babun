import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import {
  applyPickedCalendars,
  areaLevel,
  areaWord,
  calendarsBlockMode,
  dependantResets,
  draftAccessChanges,
  draftFromInvitation,
  draftLevel,
  emptyMasterDraft,
  invitationCarriesCardFields,
  invitationIdFromSegment,
  invitationRequest,
  invitationSegment,
  inviteBlockers,
  isBlockFolded,
  isDraftDirty,
  levelTone,
  toggleTeam,
  withLevel,
  withLiveTeams,
  type MasterDraft,
} from "./master-draft";

// Реестр — копия строк `access_blocks` (миграция 20260914140000): слово
// раздела и отправляемые права проверяются на настоящих ключах, с «Валютой» и
// «Какие клиенты», у которых положения «Скрыт» нет.
const OFF_READ_WRITE: AccessLevel[] = ["off", "read", "write"];
const REGISTRY: AccessBlock[] = (
  [
    ["calendar.records", "calendar", "calendar", OFF_READ_WRITE, 10],
    ["calendar.create", "calendar", "calendar", ["off", "write"], 20],
    ["record.status", "calendar", "calendar", OFF_READ_WRITE, 30],
    ["record.amount", "calendar", "calendar", OFF_READ_WRITE, 40],
    ["record.payment", "calendar", "calendar", OFF_READ_WRITE, 50],
    ["calendar.day_labels", "calendar", "calendar", OFF_READ_WRITE, 60],
    ["calendar.settings", "calendar", "company", OFF_READ_WRITE, 70],
    ["finance.operations", "finance", "calendar", OFF_READ_WRITE, 110],
    ["finance.close_day", "finance", "calendar", ["off", "write"], 150],
    ["finance.settings", "finance", "company", OFF_READ_WRITE, 160],
    ["clients", "clients", "company", OFF_READ_WRITE, 210],
    ["clients.scope", "clients", "company", ["own", "all"], 220],
    ["clients.contacts", "clients", "company", ["off", "read"], 230],
    ["services", "company", "company", OFF_READ_WRITE, 310],
    ["company.currency", "company", "company", ["read", "write"], 330],
    ["owner.access", "owner", "company", ["off"], 410],
  ] as const
).map(([key, area, scope, levels, position]) => ({
  key,
  area,
  scope,
  levels,
  title: key,
  ownerOnly: area === "owner",
  live: false,
  position,
}));

const byKey = (key: string): AccessBlock => {
  const found = REGISTRY.find((block) => block.key === key);
  if (!found) throw new Error(`нет блока ${key}`);
  return found;
};

const AREAS = ["calendar", "finance", "clients", "company"] as const;

const checks = {
  isEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
  isPhone: (value: string) => value.replace(/\D/g, "").length >= 8,
};

const twoCalendars = (): MasterDraft => toggleTeam(emptyMasterDraft("team-1"), "team-2");

describe("черновик нового мастера", () => {
  test("открыт в календаре, из которого пришли", () => {
    assert.deepEqual(emptyMasterDraft("team-1").teamIds, ["team-1"]);
    assert.deepEqual(emptyMasterDraft(null).teamIds, []);
  });

  test("нетронутый черновик: все четыре раздела «Скрыт», и слово тихое", () => {
    for (const draft of [emptyMasterDraft("team-1"), twoCalendars(), emptyMasterDraft(null)]) {
      for (const area of AREAS) {
        assert.equal(areaWord(REGISTRY, draft, area), "Скрыт", area);
        assert.equal(levelTone(areaLevel(REGISTRY, draft, area)), "faint");
      }
    }
  });

  test("календари с разными положениями — «Разное», одинаковыми — само положение", () => {
    const records = byKey("calendar.records");
    let draft = withLevel(twoCalendars(), records, "read", "team-1");
    assert.equal(areaWord(REGISTRY, draft, "calendar"), "Разное");
    assert.equal(levelTone(areaLevel(REGISTRY, draft, "calendar")), "ink");
    draft = withLevel(draft, records, "read", "team-2");
    // «Новые записи» и остальные зависимые всё ещё скрыты — раздел разный.
    assert.equal(areaWord(REGISTRY, draft, "calendar"), "Разное");
    const onlyRecords = [records];
    assert.equal(areaWord(onlyRecords, draft, "calendar"), "Смотрит");
    assert.equal(levelTone(areaLevel(onlyRecords, draft, "calendar")), "sub");
    // Охват клиентов в слово не идёт: «Все» при скрытых клиентах — всё ещё «Скрыт».
    const scoped = withLevel(twoCalendars(), byKey("clients.scope"), "all", null);
    assert.equal(areaWord(REGISTRY, scoped, "clients"), "Скрыт");
  });

  test("невыбранный блок стоит на умолчании реестра, в каждом календаре своё", () => {
    const records = byKey("calendar.records");
    const currency = byKey("company.currency");
    const draft = withLevel(twoCalendars(), records, "write", "team-1");
    assert.equal(draftLevel(records, draft, "team-1"), "write");
    assert.equal(draftLevel(records, draft, "team-2"), "off");
    assert.equal(draftLevel(records, draft, null), "off");
    assert.equal(draftLevel(currency, draft, null), "read");
  });

  test("положение, которого у блока нет, и календарь не из черновика не принимаются", () => {
    const create = byKey("calendar.create");
    const draft = emptyMasterDraft("team-1");
    assert.equal(withLevel(draft, create, "read", "team-1"), draft);
    assert.equal(withLevel(draft, create, "write", "team-9"), draft);
    assert.equal(withLevel(draft, create, "write", null), draft);
  });

  test("умолчание не хранится: вернули положение — черновик снова чистый", () => {
    const records = byKey("calendar.records");
    const services = byKey("services");
    let draft = withLevel(emptyMasterDraft("team-1"), records, "read", "team-1");
    draft = withLevel(draft, services, "write", null);
    assert.equal(isDraftDirty(draft, "team-1"), true);
    draft = withLevel(withLevel(draft, records, "off", "team-1"), services, "off", null);
    assert.deepEqual(draft.calendarLevels, {});
    assert.deepEqual(draft.companyLevels, {});
    assert.equal(isDraftDirty(draft, "team-1"), false);
  });

  test("снятый календарь уносит свои положения, добавленный снова — с умолчаний", () => {
    const records = byKey("calendar.records");
    let draft = withLevel(twoCalendars(), records, "write", "team-2");
    draft = withLevel(draft, records, "read", "team-1");
    draft = toggleTeam(draft, "team-2");
    assert.deepEqual(draft.teamIds, ["team-1"]);
    assert.equal(draft.calendarLevels["team-2"], undefined);
    assert.equal(draftLevel(records, draft, "team-1"), "read");
    draft = toggleTeam(draft, "team-2");
    assert.deepEqual(draft.teamIds, ["team-1", "team-2"]);
    assert.equal(draftLevel(records, draft, "team-2"), "off");
    assert.deepEqual(
      draftAccessChanges(REGISTRY, draft).filter((change) => change.team_id === "team-2"),
      [],
    );
  });

  test("права уходят по календарю: у каждого свои положения", () => {
    const records = byKey("calendar.records");
    const operations = byKey("finance.operations");
    const services = byKey("services");
    let draft = withLevel(twoCalendars(), records, "write", "team-1");
    draft = withLevel(draft, records, "read", "team-2");
    draft = withLevel(draft, operations, "read", "team-2");
    draft = withLevel(draft, services, "write", null);
    assert.deepEqual(draftAccessChanges(REGISTRY, draft), [
      { block: "calendar.records", team_id: "team-1", level: "write" },
      { block: "calendar.records", team_id: "team-2", level: "read" },
      { block: "finance.operations", team_id: "team-2", level: "read" },
      { block: "services", team_id: null, level: "write" },
    ]);
  });

  test("«Календарь и записи» скрыт — его зависимые сброшены только в этом календаре", () => {
    const records = byKey("calendar.records");
    let draft = twoCalendars();
    for (const teamId of ["team-1", "team-2"]) {
      draft = withLevel(draft, records, "write", teamId);
      draft = withLevel(draft, byKey("calendar.create"), "write", teamId);
      draft = withLevel(draft, byKey("record.status"), "write", teamId);
      draft = withLevel(draft, byKey("record.amount"), "read", teamId);
      draft = withLevel(draft, byKey("record.payment"), "read", teamId);
      draft = withLevel(draft, byKey("calendar.day_labels"), "read", teamId);
    }
    draft = withLevel(draft, byKey("calendar.settings"), "read", null);
    draft = withLevel(draft, records, "off", "team-1");
    assert.equal(draft.calendarLevels["team-1"], undefined);
    assert.equal(draftLevel(byKey("calendar.create"), draft, "team-2"), "write");
    assert.equal(draftLevel(byKey("calendar.day_labels"), draft, "team-2"), "read");
    assert.equal(draftLevel(byKey("calendar.settings"), draft, null), "read");

    let clients = withLevel(emptyMasterDraft("team-1"), byKey("clients"), "read", null);
    clients = withLevel(clients, byKey("clients.scope"), "all", null);
    clients = withLevel(clients, byKey("clients.contacts"), "read", null);
    clients = withLevel(clients, byKey("clients"), "off", null);
    assert.deepEqual(clients.companyLevels, {});
  });

  test("свёрнутое не уходит и не меняет слово раздела, даже если лежит в строке", () => {
    const draft = draftFromInvitation({
      email: "d@airfix.cy",
      team_id: "team-1",
      access_changes: [
        { block: "calendar.create", team_id: "team-1", level: "write" },
        { block: "clients.contacts", team_id: null, level: "read" },
      ],
    });
    assert.deepEqual(draftAccessChanges(REGISTRY, draft), []);
    assert.equal(areaWord(REGISTRY, draft, "calendar"), "Скрыт");
    assert.equal(areaWord(REGISTRY, draft, "clients"), "Скрыт");
    const parentLevel = (key: string) => draftLevel(byKey(key), draft, "team-1");
    assert.equal(isBlockFolded("calendar.create", parentLevel), true);
    assert.equal(isBlockFolded("calendar.records", parentLevel), false);
  });

  test("живому сотруднику скрытие главного блока сбрасывает зависимые на умолчание", () => {
    assert.deepEqual(dependantResets(REGISTRY, byKey("clients"), "off", null), [
      { block: "clients.scope", team_id: null, level: "own" },
      { block: "clients.contacts", team_id: null, level: "off" },
    ]);
    assert.deepEqual(
      dependantResets(REGISTRY, byKey("calendar.records"), "off", "team-1").map((c) => c.block),
      ["calendar.create", "record.status", "record.amount", "record.payment", "calendar.day_labels"],
    );
    assert.deepEqual(dependantResets(REGISTRY, byKey("calendar.records"), "read", "team-1"), []);
    assert.deepEqual(dependantResets(REGISTRY, byKey("services"), "off", null), []);
  });

  test("до «Пригласить» нужны имя, почта и календарь; телефон — только если набран", () => {
    assert.deepEqual(inviteBlockers(emptyMasterDraft(null), checks), [
      "name",
      "email",
      "calendar",
    ]);
    const filled = { ...emptyMasterDraft("team-1"), name: "Dmitry", email: "d@airfix.cy" };
    assert.deepEqual(inviteBlockers(filled, checks), []);
    assert.deepEqual(inviteBlockers({ ...filled, phone: "12" }, checks), ["phone"]);
  });

  test("приглашение из черновика: обрезано, пустое не шлётся, календари без повторов", () => {
    const records = byKey("calendar.records");
    let draft: MasterDraft = {
      ...emptyMasterDraft("team-2"),
      name: "  Dmitry ",
      email: " d@airfix.cy ",
      phone: "",
      title: "   ",
    };
    draft = toggleTeam(draft, "team-1");
    draft = withLevel(draft, records, "read", "team-2");
    draft = withLevel(draft, records, "write", "team-1");
    draft = { ...draft, teamIds: ["team-2", "team-1", "team-2"] };
    const toPhone = (value: string) => (value.trim() ? "+35799123456" : null);
    assert.deepEqual(invitationRequest(draft, REGISTRY, toPhone), {
      email: "d@airfix.cy",
      fullName: "Dmitry",
      phone: null,
      teamIds: ["team-2", "team-1"],
      title: null,
      color: null,
      access: [
        { block: "calendar.records", team_id: "team-2", level: "read" },
        { block: "calendar.records", team_id: "team-1", level: "write" },
      ],
    });
    const full = invitationRequest(
      { ...draft, phone: "99 123456", title: " Техник ", color: "#1F6FEB" },
      REGISTRY,
      toPhone,
    );
    assert.equal(full.phone, "+35799123456");
    assert.equal(full.title, "Техник");
    assert.equal(full.color, "#1F6FEB");
    assert.equal(invitationRequest({ ...draft, phone: "12" }, [], () => undefined).phone, null);
  });

  test("блок «Календари»: дверь — только там, где она открывается", () => {
    assert.equal(calendarsBlockMode(0, true), "choose");
    assert.equal(calendarsBlockMode(0, false), "empty-words");
    assert.equal(calendarsBlockMode(2, true), "rows-tappable");
    assert.equal(calendarsBlockMode(1, false), "rows-display");
  });

  test("тронутый черновик спрашивает перед уходом", () => {
    const draft = emptyMasterDraft("team-1");
    assert.equal(isDraftDirty(draft, "team-1"), false);
    assert.equal(isDraftDirty({ ...draft, name: "D" }, "team-1"), true);
    assert.equal(isDraftDirty(toggleTeam(draft, "team-2"), "team-1"), true);
    assert.equal(isDraftDirty(emptyMasterDraft(null), null), false);
  });
});

describe("карточка ждущего приглашения", () => {
  test("новые колонки: календари, должность, цвет и права по календарям", () => {
    const draft = draftFromInvitation({
      id: "7b0c2f7e-1d2a-4f1b-9a51-0e1d2c3b4a59",
      email: "d@airfix.cy",
      full_name: "Dmitry",
      phone: "+35799123456",
      team_id: "team-1",
      team_ids: ["team-1", "team-2"],
      master_title: " Техник ",
      master_color: "#1F6FEB",
      access_changes: [
        { block: "calendar.records", team_id: "team-1", level: "write" },
        { block: "calendar.records", team_id: "team-2", level: "read" },
        { block: "services", team_id: null, level: "write" },
      ],
    });
    assert.deepEqual(draft, {
      name: "Dmitry",
      email: "d@airfix.cy",
      phone: "+35799123456",
      title: "Техник",
      color: "#1F6FEB",
      teamIds: ["team-1", "team-2"],
      companyLevels: { services: "write" },
      calendarLevels: {
        "team-1": { "calendar.records": "write" },
        "team-2": { "calendar.records": "read" },
      },
    });
    assert.deepEqual(draftAccessChanges(REGISTRY, draft), [
      { block: "calendar.records", team_id: "team-1", level: "write" },
      { block: "calendar.records", team_id: "team-2", level: "read" },
      { block: "services", team_id: null, level: "write" },
    ]);
  });

  test("до обновления базы колонок нет — один домашний календарь и умолчания", () => {
    const draft = draftFromInvitation({
      email: "d@airfix.cy",
      full_name: null,
      phone: null,
      team_id: "team-1",
    });
    assert.deepEqual(draft, { ...emptyMasterDraft("team-1"), email: "d@airfix.cy" });
    assert.deepEqual(draftFromInvitation({ email: "x@y.z", team_id: null }).teamIds, []);
  });

  test("мусор в строке пропускается, домашний календарь — первым", () => {
    const draft = draftFromInvitation({
      email: "d@airfix.cy",
      team_id: "team-1",
      team_ids: ["team-2", 7, "", "team-1", "team-2"],
      master_title: 42,
      master_color: "red",
      access_changes: [
        null,
        "calendar.records",
        { block: "calendar.records", team_id: "team-1", level: "admin" },
        { block: "calendar.records", team_id: "team-9", level: "write" },
        { block: "", team_id: null, level: "write" },
        { block: "services", level: "read" },
      ],
    });
    assert.deepEqual(draft.teamIds, ["team-1", "team-2"]);
    assert.equal(draft.title, "");
    assert.equal(draft.color, null);
    assert.deepEqual(draft.calendarLevels, {});
    assert.deepEqual(draft.companyLevels, { services: "read" });
    assert.deepEqual(draftFromInvitation({ access_changes: { block: "services" } }).companyLevels, {});
  });

  test("«Применить» календари: имя из карточки сейчас, уровни снятого уходят", () => {
    const records = byKey("calendar.records");
    let atOpen = withLevel(twoCalendars(), records, "write", "team-1");
    atOpen = withLevel(atOpen, records, "read", "team-2");
    atOpen = { ...atOpen, name: "Старое", phone: "+35799000000", title: "Техник" };
    // Шторку открыли — клавиатура ушла, и уход из поля сохранил новое имя.
    const now = { ...atOpen, name: "Новое", phone: "+35799111111", title: "Мастер" };
    const applied = applyPickedCalendars(now, ["team-1", "team-3"]);
    assert.equal(applied.name, "Новое");
    assert.equal(applied.phone, "+35799111111");
    assert.equal(applied.title, "Мастер");
    assert.deepEqual(applied.teamIds, ["team-1", "team-3"]);
    assert.deepEqual(applied.calendarLevels, { "team-1": { "calendar.records": "write" } });
  });

  test("архивный календарь уходит со страницы и из отправки вместе с уровнями", () => {
    const records = byKey("calendar.records");
    let draft = toggleTeam(emptyMasterDraft("archived"), "team-2");
    draft = withLevel(draft, records, "write", "archived");
    draft = withLevel(draft, records, "read", "team-2");
    const live = withLiveTeams(draft, new Set(["team-2"]));
    assert.deepEqual(live.teamIds, ["team-2"]);
    assert.deepEqual(live.calendarLevels, { "team-2": { "calendar.records": "read" } });
    assert.equal(withLiveTeams(live, new Set(["team-2", "team-9"])), live);
  });

  test("должность и цвет правятся только у приглашения мастера без карточки", () => {
    assert.equal(invitationCarriesCardFields({ role: "master", master_id: null }), true);
    assert.equal(invitationCarriesCardFields({ role: "master" }), true);
    assert.equal(invitationCarriesCardFields({ role: "master", master_id: "m-1" }), false);
    assert.equal(invitationCarriesCardFields({ role: "dispatcher", master_id: null }), false);
  });

  test("адрес карточки приглашения: invite-<uuid>, без двоеточия и строго", () => {
    const id = "7b0c2f7e-1d2a-4f1b-9a51-0e1d2c3b4a59";
    assert.equal(invitationSegment(id), `invite-${id}`);
    assert.equal(invitationIdFromSegment(invitationSegment(id)), id);
    assert.equal(invitationIdFromSegment(`invite:${id}`), null);
    assert.equal(invitationIdFromSegment(`invite-${id}x`), null);
    assert.equal(invitationIdFromSegment("invite-short"), null);
    assert.equal(invitationIdFromSegment("new"), null);
    assert.equal(invitationIdFromSegment("master-1"), null);
    assert.equal(invitationIdFromSegment(undefined), null);
  });
});
