import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { labelsOfferedFor, servingTeamIds } from "./serving-teams";
import { filterLabelsFor, filterTagsFor } from "./list/list-derive";
import { bulkTagsOffered } from "./bulk-edit";
import type { ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";

// ВАРИАНТЫ У КЛИЕНТА = ТОЛЬКО ОБСЛУЖИВАЮЩИЕ АКТИВНЫЕ КАЛЕНДАРИ.
// Случай владельца: клиент «Александр» команды Y&D, обслуживала только Y&D, а
// шторка «Метка клиента» предлагала метки всех календарей компании — и
// «Кабинет 1», «Ирина» из календарей в архиве.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const YD = "team-yd";
const DK = "team-dk";
const ARCHIVED = "team-irina";
const archived = new Set([ARCHIVED]);
const label = (name: string, team_id: string, extra: object = {}) => ({
  name,
  team_id,
  color: null,
  is_active: true,
  deleted_at: null as string | null,
  ...extra,
});
const company = [
  label("Paphos", YD),
  label("Limassol", YD),
  label("Paphos", DK),
  label("Nicosia", DK),
  label("Кабинет 1", ARCHIVED),
  label("Старая", YD, { deleted_at: "2026-10-01" }),
  label("Выключена", YD, { is_active: false }),
];
const appt = (
  client_id: string,
  team_id: string,
  status: Appointment["status"] = "scheduled",
): Pick<Appointment, "client_id" | "team_id" | "status"> => ({ client_id, team_id, status });

describe("обслуживающие календари клиента", () => {
  test("своя команда и команды неотменённых записей", () => {
    const ids = servingTeamIds({ id: "c1", team_id: YD }, [appt("c1", DK), appt("c2", ARCHIVED)], archived);
    assert.deepEqual([...ids].sort(), [DK, YD].sort());
  });
  test("отменённая запись и чужой клиент не делают календарь обслуживающим", () => {
    const ids = servingTeamIds({ id: "c1", team_id: YD }, [appt("c1", DK, "cancelled"), appt("c2", DK)], archived);
    assert.deepEqual([...ids], [YD]);
  });
  test("календарь в архиве не обслуживает никого — даже своего клиента", () => {
    const ids = servingTeamIds({ id: "c1", team_id: ARCHIVED }, [appt("c1", ARCHIVED)], archived);
    assert.equal(ids.size, 0);
  });
});

describe("шторка «Метка клиента»", () => {
  test("клиент Y&D видит только метки Y&D — живые, без удалённых и архива", () => {
    const names = labelsOfferedFor(company, servingTeamIds({ id: "c1", team_id: YD }, [], archived)).map(
      (l) => l.name,
    );
    assert.deepEqual(names, ["Paphos", "Limassol"]);
  });
  test("две команды — одно имя одной строкой", () => {
    const names = labelsOfferedFor(company, new Set([YD, DK])).map((l) => l.name);
    assert.deepEqual(names, ["Paphos", "Limassol", "Nicosia"]);
  });
  test("карточка строит варианты по обслуживающим календарям, а не по всей компании", () => {
    const tiles = read("ClientLabelTags.tsx");
    assert.match(tiles, /servingTeamIds\(client, appointments, archivedTeamIds\)/);
    assert.match(tiles, /labelsOfferedFor\(cities, servingTeams\)/);
    assert.match(tiles, /options=\{labelOptions\}/);
    // Прежний обход всего справочника не вернулся.
    assert.doesNotMatch(tiles, /return cities\s*\.filter/);
    assert.match(read("card/ClientCardPage.tsx"), /<ClientLabelTags\s+client=\{c\}\s+appointments=\{appointments\}/);
  });
});

describe("фильтры списка и пачка — календари ленты", () => {
  const ribbon = [{ id: YD, name: "Y&D" }, { id: DK, name: "D&K" }];
  test("метки фильтра: без чипа — календарей ленты, под чипом — его", () => {
    assert.deepEqual(filterLabelsFor(company, ribbon, null).map((l) => l.name), ["Paphos", "Limassol", "Paphos", "Nicosia"]);
    assert.deepEqual(filterLabelsFor(company, ribbon, DK).map((l) => l.name), ["Paphos", "Nicosia"]);
  });
  test("теги фильтра без чипа — без тегов календаря в архиве", () => {
    const tags = [{ name: "VIP", team_id: YD }, { name: "Старый", team_id: ARCHIVED }];
    assert.deepEqual(filterTagsFor(tags, ribbon, null).map((t) => t.name), ["VIP"]);
  });
  test("пачка «Поставить теги» не предлагает тег календаря в архиве, снять — можно", () => {
    const tags = [
      { id: "t1", name: "VIP", color: "#000", team_id: YD },
      { id: "t2", name: "Старый", color: "#000", team_id: ARCHIVED },
    ] as ClientTag[];
    const clients = [{ team_id: YD, tag_ids: [] }, { team_id: ARCHIVED, tag_ids: ["t2"] }];
    assert.deepEqual(bulkTagsOffered(tags, clients, "add", null, archived).map((t) => t.id), ["t1"]);
    assert.deepEqual(bulkTagsOffered(tags, clients, "remove", null, archived).map((t) => t.id), ["t2"]);
  });
  test("список отдаёт фильтру метки ленты", () => {
    const src = read("list/use-list-filters.ts");
    assert.match(src, /filterLabelsFor\(cities, teams, null\)/);
    assert.match(src, /teams,\s*filterLabels,\s*filterTags,/);
    assert.match(read("list/use-list-bulk-edit.ts"), /fallbackTeam, archivedTeamIds\)/);
  });
});

describe("источник и тип объекта — без календарей в архиве", () => {
  test("источник клиента архивной команды не предлагается", () => {
    const src = read("blocks/PersonalBlock.tsx");
    assert.match(src, /sourceTeamId && archivedTeamIds\.has\(sourceTeamId\)\s*\?\s*\[\]\s*:\s*sourcePickerOptions\(sources, sourceTeamId\)/);
  });
  test("типы объекта архивной команды не предлагаются", () => {
    const src = read("ObjectFields.tsx");
    assert.match(src, /teamId && archivedTeamIds\.has\(teamId\)\s*\?\s*\[\]/);
    assert.match(src, /!preset\.teamId \|\| !archivedTeamIds\.has\(preset\.teamId\)/);
  });
});

describe("«Кто привёл» — ровно видимое в «Клиентах»", () => {
  test("те же строки по тем же правам, без клиентов команд в архиве", () => {
    const src = read("blocks/PersonalBlock.tsx");
    assert.match(src, /const \{ data: allClients = \[\] \} = useClients\(\);/);
    assert.match(src, /withoutArchivedTeams\(allClients, archivedTeamIds, companyAppointments\)/);
    assert.match(src, /title="Кто привёл"\s*clients=\{referrerPool\}/);
  });
});
