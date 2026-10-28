import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { levelOf as mapLevelOf, type AccessBlock, type AccessLevel, type MemberAccessMap } from "@/session/access-map";
import { stepAllowed } from "@/session/partner-manager";
import { emptyMasterDraft, parentBlocksOf, visibleLevel } from "./master-draft";
import { offeredBlocks } from "./rights-copy";
import { draftWithRole } from "./role-draft";
import { ROLE_PRESETS, matchRole, rolePreset, roleAllowed, roleChanges, roleLevel } from "./role-presets";
import { rightsSections, withMemberChanges } from "./rights-rows";

// РОЛЬ → ПОЛОЖЕНИЯ. Реестр — снимок `access_blocks` боевой базы:
// роли обязаны говорить о настоящих ключах и настоящих ступенях, иначе
// «Директор» молча не выдал бы того, что сервер давно проверяет.

const ORW: AccessLevel[] = ["off", "read", "write"];
const OW: AccessLevel[] = ["off", "write"];
const OR: AccessLevel[] = ["off", "read"];
const WINDOW: AccessLevel[] = ["week", "near", "month", "quarter", "half", "own"];
const MONEY: AccessLevel[] = ["off", "read", "write", "full"];

type Row = [string, AccessBlock["area"], AccessBlock["scope"], AccessLevel[], boolean, boolean?];
const ROWS: Row[] = [
  ["calendar.records", "calendar", "calendar", ORW, true],
  ["calendar.window", "calendar", "calendar", WINDOW, true],
  ["calendar.create", "calendar", "calendar", OW, true],
  ["calendar.events", "calendar", "calendar", ORW, true],
  ["calendar.move", "calendar", "calendar", OW, true],
  ["calendar.event_types", "calendar", "company", ORW, false],
  ["calendar.cancel", "calendar", "calendar", OW, true],
  ["calendar.day_money", "calendar", "calendar", ORW, true],
  ["record.team", "calendar", "calendar", ["read", "write"], true],
  ["record.label", "calendar", "calendar", ORW, true],
  ["record.when", "calendar", "calendar", ORW, false],
  ["record.client", "calendar", "calendar", ORW, true],
  ["record.object", "calendar", "calendar", ORW, true],
  ["record.services", "calendar", "calendar", OR, true],
  ["record.color", "calendar", "calendar", OW, true],
  ["record.note", "calendar", "calendar", ORW, true],
  ["record.amount", "calendar", "calendar", ORW, true],
  ["record.payment", "calendar", "calendar", ORW, true],
  ["record.files", "calendar", "calendar", ORW, true],
  ["record.sms", "calendar", "calendar", OR, true],
  ["calendar.day_labels", "calendar", "calendar", ORW, true],
  ["event.label", "calendar", "calendar", ORW, true],
  ["event.client", "calendar", "calendar", ORW, true],
  ["event.object", "calendar", "calendar", ORW, true],
  ["event.type", "calendar", "calendar", ORW, true],
  ["event.note", "calendar", "calendar", ORW, true],
  ["event.files", "calendar", "calendar", ORW, true],
  ["calendar.settings", "calendar", "company", ORW, false],
  ["calendar.schedule", "calendar", "calendar", ORW, true],
  ["calendar.identity", "calendar", "calendar", ORW, true],
  ["calendar.timezone", "calendar", "calendar", ORW, true],
  ["calendar.hours", "calendar", "calendar", ORW, true],
  ["calendar.booking_form", "calendar", "calendar", ORW, true],
  ["calendar.services", "calendar", "calendar", ORW, true],
  ["calendar.labels", "calendar", "calendar", ORW, true],
  ["finance.accounts", "finance", "calendar", ORW, true],
  ["finance.documents", "finance", "calendar", ORW, true],
  ["finance.income", "finance", "calendar", MONEY, true],
  ["finance.expense", "finance", "calendar", MONEY, true],
  ["finance.debts", "finance", "calendar", ORW, true],
  ["finance.window", "finance", "calendar", WINDOW, true],
  ["finance.settings_accounts", "finance", "calendar", ORW, true],
  ["finance.settings_trash", "finance", "calendar", ORW, true],
  ["finance.settings_categories_income", "finance", "calendar", ORW, true],
  ["finance.settings_categories_expense", "finance", "calendar", ORW, true],
  ["finance.settings_categories_debts", "finance", "calendar", ORW, true],
  ["finance.settings_requisites", "finance", "company", OR, true],
  ["finance.settings_currency", "finance", "company", OR, true],
  ["clients", "clients", "calendar", OR, true],
  ["clients.scope", "clients", "calendar", WINDOW, true],
  ["clients.create", "clients", "calendar", OW, true],
  ["clients.menu", "clients", "calendar", OW, true],
  ["clients.delete", "clients", "calendar", OW, true],
  ["clients.client", "clients", "calendar", ORW, true],
  ["clients.note", "clients", "calendar", ORW, true],
  ["clients.people", "clients", "calendar", ORW, true],
  ["clients.objects", "clients", "calendar", ORW, true],
  ["clients.labels", "clients", "calendar", ORW, true],
  ["clients.tags", "clients", "calendar", ORW, true],
  ["clients.filters", "clients", "company", ORW, false],
  ["clients.personal", "clients", "calendar", ORW, true],
  ["clients.files", "clients", "calendar", ORW, true],
  ["clients.requisites", "clients", "calendar", ORW, true],
  ["clients.history", "clients", "calendar", ORW, true],
  ["clients.sms", "clients", "calendar", ORW, true],
  ["clients.settings_card", "clients", "calendar", ORW, true],
  ["clients.settings_ways", "clients", "calendar", ORW, true],
  ["clients.settings_objects", "clients", "calendar", ORW, true],
  ["clients.settings_maps", "clients", "calendar", ORW, true],
  ["clients.settings_tags", "clients", "calendar", ORW, true],
  ["clients.settings_sources", "clients", "calendar", ORW, true],
  ["services", "company", "company", ORW, false],
  ["company.inventory", "company", "company", ORW, false],
  ["cabinet.tariff", "company", "company", ORW, true],
  ["cabinet.tariff_payments", "company", "company", OR, true],
  ["cabinet.sms", "company", "company", ORW, true],
  ["cabinet.history", "company", "company", OR, true],
  ["company.partners", "company", "company", ORW, true],
  ["owner.access", "owner", "company", ["off"], false, true],
  ["owner.billing", "owner", "company", ["off"], false, true],
];
const REGISTRY: AccessBlock[] = ROWS.map(([key, area, scope, levels, live, ownerOnly], i) => ({
  key,
  area,
  scope,
  levels,
  title: key,
  ownerOnly: ownerOnly ?? false,
  live,
  position: i,
}));
const BY_KEY = new Map(REGISTRY.map((block) => [block.key, block]));
const TEAM = "team-1";
const OTHER = "team-2";

function emptyMap(): MemberAccessMap {
  return {
    tenantId: "tenant-1",
    isOwner: false,
    version: 1,
    company: {},
    calendars: { [TEAM]: {}, [OTHER]: {} },
    attachedCalendars: [TEAM, OTHER],
  };
}
const readerOf = (map: MemberAccessMap) => (block: AccessBlock, teamId: string | null) =>
  mapLevelOf(block, map, teamId ?? "");

function applied(map: MemberAccessMap, key: Parameters<typeof rolePreset>[0]): MemberAccessMap {
  const changes = roleChanges(REGISTRY, rolePreset(key), TEAM, readerOf(map));
  return changes ? withMemberChanges(map, REGISTRY, changes) : map;
}

describe("роли — настоящие ключи и ступени", () => {
  for (const role of ROLE_PRESETS) {
    test(`${role.title}: каждое положение есть у своего блока`, () => {
      for (const [key, level] of Object.entries(role.levels)) {
        const block = BY_KEY.get(key);
        assert.ok(block, `${role.title}: блока ${key} нет в реестре`);
        assert.ok(block.live && !block.ownerOnly, `${role.title}: ${key} — не строка страницы`);
        assert.ok(block.levels.includes(level), `${role.title}: у ${key} нет ступени ${level}`);
      }
    });

    test(`${role.title}: открытое право не висит под скрытым главным`, () => {
      for (const block of offeredBlocks(REGISTRY)) {
        const level = roleLevel(role, block);
        if (level === block.levels[0]) continue;
        for (const parentKey of parentBlocksOf(block.key)) {
          const parent = BY_KEY.get(parentKey);
          if (!parent) continue;
          assert.notEqual(roleLevel(role, parent), "off", `${role.title}: ${block.key} открыт, а ${parentKey} скрыт`);
        }
      }
    });

    test(`${role.title}: спутники согласованы (перенос = цвет, создание — при «Видит и создаёт»)`, () => {
      const level = (key: string) => roleLevel(role, BY_KEY.get(key) as AccessBlock);
      assert.equal(level("record.color"), level("calendar.move"));
      assert.equal(level("calendar.create") === "write", level("calendar.records") === "write");
    });
  }

  test("директор называет каждое право страницы, и всё — верхней ступенью, кроме денег аккаунта", () => {
    const director = rolePreset("director");
    const notTop = new Set(["cabinet.tariff", "cabinet.sms"]);
    for (const block of offeredBlocks(REGISTRY)) {
      assert.ok(block.key in director.levels, `директор молчит о ${block.key}`);
      const top = block.levels[block.levels.length - 1];
      if (notTop.has(block.key)) assert.equal(director.levels[block.key], "read", block.key);
      else assert.equal(director.levels[block.key], top, block.key);
    }
  });

  test("мастер: денег команды, базы клиентов и прав аккаунта нет", () => {
    const master = rolePreset("master");
    for (const block of offeredBlocks(REGISTRY)) {
      if (block.area === "finance" || block.area === "company" || block.key === "clients") {
        assert.equal(roleLevel(master, block), block.levels[0], block.key);
      }
    }
    assert.equal(master.levels["record.payment"], "write", "оплату на месте принимает");
  });

  test("только директор получает «Партнёров»", () => {
    for (const role of ROLE_PRESETS) {
      const partners = roleLevel(role, BY_KEY.get("company.partners") as AccessBlock);
      assert.equal(partners, role.key === "director" ? "write" : "off", role.title);
    }
  });
});

describe("выдача ролью", () => {
  test("пачка — только меняющиеся права, каждое один раз, со своей командой", () => {
    const changes = roleChanges(REGISTRY, rolePreset("lead"), TEAM, readerOf(emptyMap()));
    assert.ok(changes);
    const ids = changes.map((change) => `${change.block}@${change.team_id ?? ""}`);
    assert.equal(new Set(ids).size, ids.length, "один блок дважды — сервер отказывает");
    for (const change of changes) {
      const block = BY_KEY.get(change.block) as AccessBlock;
      assert.equal(change.team_id, block.scope === "calendar" ? TEAM : null, change.block);
      assert.notEqual(change.level, block.levels[0], `${change.block}: умолчание и так стоит`);
    }
    assert.ok(!changes.some((change) => !BY_KEY.get(change.block)?.live), "неживое не шлём");
  });

  for (const role of ROLE_PRESETS) {
    test(`${role.title}: выдал — страница узнаёт роль; вторая выдача ничего не шлёт`, () => {
      const map = applied(emptyMap(), role.key);
      assert.equal(matchRole(REGISTRY, readerOf(map), TEAM), role.key);
      assert.equal(roleChanges(REGISTRY, role, TEAM, readerOf(map)), null);
      // Права другой команды ролью не тронуты.
      assert.deepEqual(map.calendars[OTHER], {});
    });
  }

  test("роль поверх другой роли — та же картина, что с нуля", () => {
    const fromDirector = applied(applied(emptyMap(), "director"), "master");
    const fresh = applied(emptyMap(), "master");
    assert.deepEqual(fromDirector.calendars[TEAM], fresh.calendars[TEAM]);
    assert.deepEqual(fromDirector.company, fresh.company, "понижение снимает «Партнёров»");
  });

  test("поправил одну строку — «Своя»", () => {
    const map = applied(emptyMap(), "master");
    const tweaked = withMemberChanges(map, REGISTRY, [{ block: "calendar.cancel", team_id: TEAM, level: "write" }]);
    assert.equal(matchRole(REGISTRY, readerOf(tweaked), TEAM), null);
  });

  test("пустые права — «Своя», а не «Мастер»", () => {
    assert.equal(matchRole(REGISTRY, readerOf(emptyMap()), TEAM), null);
  });

  test("строки страницы после роли говорят её словами", () => {
    const lead = applied(emptyMap(), "lead");
    const rows = rightsSections(REGISTRY, readerOf(lead), TEAM).flatMap((section) => section.rows);
    const row = (key: string) => rows.find((each) => each.block.key === key);
    assert.equal(row("calendar.records")?.level, "write", "Записи клиентов: Видит и создаёт");
    assert.equal(row("record.services")?.level, "write", "Услуги: Видит и меняет");
    assert.equal(row("record.when")?.level, "write", "Время — переносит");
    const master = applied(emptyMap(), "master");
    const masterRows = rightsSections(REGISTRY, readerOf(master), TEAM).flatMap((section) => section.rows);
    assert.equal(masterRows.find((each) => each.block.key === "calendar.records")?.level, "read");
    assert.equal(masterRows.find((each) => each.block.key === "record.services")?.level, "read");
    // Базы нет — её строки свёрнуты, а не «выключены» поштучно.
    assert.equal(masterRows.find((each) => each.block.key === "clients.client")?.foldedBy, "clients");
  });
});

describe("роль в черновике и приглашении", () => {
  for (const role of ROLE_PRESETS) {
    test(`${role.title}: черновик узнаёт роль, умолчания не хранятся`, () => {
      const draft = draftWithRole(emptyMasterDraft(TEAM), REGISTRY, role, TEAM);
      assert.equal(matchRole(REGISTRY, visibleLevel(REGISTRY, draft), TEAM), role.key);
      for (const [key, level] of Object.entries(draft.calendarLevels[TEAM] ?? {})) {
        assert.notEqual(level, BY_KEY.get(key)?.levels[0], `${key}: умолчание в черновике`);
      }
    });
  }

  test("заготовка нового партнёра — «Своя»: роль выбирают явно", () => {
    const draft = emptyMasterDraft(TEAM);
    assert.equal(matchRole(REGISTRY, visibleLevel(REGISTRY, draft), TEAM), null);
  });
});

describe("директор выдаёт роль", () => {
  const directorMap: MemberAccessMap = (() => {
    const map = applied(emptyMap(), "director");
    return { ...map, calendars: { [TEAM]: map.calendars[TEAM] ?? {} }, attachedCalendars: [TEAM] };
  })();
  const viewer = { role: "master", myMap: directorMap };
  const allows = (block: AccessBlock, teamId: string | null, level: AccessLevel) =>
    stepAllowed(viewer, block, teamId, level);

  test("«Директора» не выдаёт — «Партнёров» ставит только владелец", () => {
    assert.equal(roleAllowed(REGISTRY, rolePreset("director"), TEAM, readerOf(emptyMap()), allows), false);
  });

  test("«Мастера» и «Тимлида» в своей команде — выдаёт", () => {
    assert.equal(roleAllowed(REGISTRY, rolePreset("master"), TEAM, readerOf(emptyMap()), allows), true);
    assert.equal(roleAllowed(REGISTRY, rolePreset("lead"), TEAM, readerOf(emptyMap()), allows), true);
  });

  test("в чужой команде — ничего", () => {
    assert.equal(roleAllowed(REGISTRY, rolePreset("master"), OTHER, readerOf(emptyMap()), allows), false);
  });

  test("тимлид не выдаёт выше своего («Директор» его денег не видит)", () => {
    const leadMap = applied(emptyMap(), "lead");
    const leadViewer = {
      role: "master",
      myMap: { ...leadMap, company: { ...leadMap.company, "company.partners": "write" as AccessLevel } },
    };
    const leadAllows = (block: AccessBlock, teamId: string | null, level: AccessLevel) =>
      stepAllowed(leadViewer, block, teamId, level);
    assert.equal(roleAllowed(REGISTRY, rolePreset("master"), TEAM, readerOf(emptyMap()), leadAllows), true);
    assert.equal(roleAllowed(REGISTRY, rolePreset("director"), TEAM, readerOf(emptyMap()), leadAllows), false);
  });
});
