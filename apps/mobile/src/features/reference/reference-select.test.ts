import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pickLiveServices,
  pickLiveTeams,
  pickTeamLabels,
} from "./reference-select";

// ОТБОР НА УСТРОЙСТВЕ ОБЯЗАН СОВПАДАТЬ С ФИЛЬТРОМ ЗАПРОСА, КОТОРЫЙ ОН ЗАМЕНИЛ.
// Справа в каждом тесте — то, что вернул бы прежний узкий запрос на тех же
// строках: `.eq("team_id", …)` у меток, `.eq("is_active", true)` у команд и у
// услуг владельца. Порядок строк — порядок `position`, отбор его не меняет.

const labels = [
  { id: "l1", team_id: "team-a", is_active: true },
  { id: "l2", team_id: "team-b", is_active: true },
  { id: "l3", team_id: "team-a", is_active: false },
  { id: "l4", team_id: null, is_active: true },
];

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("метки дня одной команды", () => {
  test("с командой — только её метки, в прежнем порядке", () => {
    assert.deepEqual(ids(pickTeamLabels(labels, "team-a")), ["l1", "l3"]);
  });

  test("чужая команда своих меток не получает", () => {
    assert.deepEqual(ids(pickTeamLabels(labels, "team-b")), ["l2"]);
  });

  test("метка без команды под фильтр команды не попадает (eq на null — ложь)", () => {
    assert.ok(!ids(pickTeamLabels(labels, "team-a")).includes("l4"));
  });

  test("без команды — весь справочник компании, как без .eq", () => {
    assert.deepEqual(ids(pickTeamLabels(labels, null)), ["l1", "l2", "l3", "l4"]);
    assert.deepEqual(ids(pickTeamLabels(labels, undefined)), ["l1", "l2", "l3", "l4"]);
    // `if (teamId)` в fetchCities пропускает и пустую строку.
    assert.deepEqual(ids(pickTeamLabels(labels, "")), ["l1", "l2", "l3", "l4"]);
  });

  test("неизвестная команда — пусто", () => {
    assert.deepEqual(pickTeamLabels(labels, "team-z"), []);
  });
});

describe("активные команды из полного списка", () => {
  const teams = [
    { id: "t1", is_active: true },
    { id: "t2", is_active: false },
    { id: "t3", is_active: true },
  ];

  test("архивные отсечены, порядок цел", () => {
    assert.deepEqual(ids(pickLiveTeams(teams)), ["t1", "t3"]);
  });
});

describe("услуги каталога выбора из полного справочника", () => {
  const services = [
    { id: "s1", is_active: true },
    { id: "s2", is_active: false },
    { id: "s3", is_active: true },
  ];

  test("владелец — только живые, как .eq(is_active, true)", () => {
    assert.deepEqual(ids(pickLiveServices(services, "owner")), ["s1", "s3"]);
  });

  test("мастер и диспетчер — ровно проекция RPC, без добавочного отбора", () => {
    assert.deepEqual(ids(pickLiveServices(services, "master")), ["s1", "s2", "s3"]);
    assert.deepEqual(ids(pickLiveServices(services, "dispatcher")), ["s1", "s2", "s3"]);
  });
});
