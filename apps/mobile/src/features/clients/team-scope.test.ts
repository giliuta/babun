import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALL_TEAMS,
  appointmentsOfTeam,
  clientsOfTeam,
  liveTeamChoice,
  teamForNewClient,
  toggleTeamChoice,
} from "./team-scope";

const teams = ["team-1", "team-3"];
const clients = [
  { id: "a", team_id: "team-1" },
  { id: "b", team_id: "team-3" },
  { id: "c", team_id: null },
];

describe("лента команд во вкладке «Клиенты»", () => {
  test("«Все» — все клиенты, включая без команды", () => {
    assert.deepEqual(clientsOfTeam(clients, ALL_TEAMS).map((c) => c.id), ["a", "b", "c"]);
  });

  test("команда — только её клиенты", () => {
    assert.deepEqual(clientsOfTeam(clients, "team-3").map((c) => c.id), ["b"]);
  });

  test("клиент один на две команды: виден и там, где его обслуживали", () => {
    const apts = [
      { team_id: "team-3", client_id: "a", status: "completed" as const },
      { team_id: "team-3", client_id: "c", status: "cancelled" as const },
    ];
    // «a» — клиент Команды 1, обслужен Командой 3; отменённая запись «c» не в счёт.
    assert.deepEqual(clientsOfTeam(clients, "team-3", apts).map((c) => c.id), ["a", "b"]);
    assert.deepEqual(clientsOfTeam(clients, "team-1", apts).map((c) => c.id), ["a"]);
  });

  test("под чипом считаются только записи этой команды", () => {
    const apts = [{ team_id: "team-1" }, { team_id: "team-3" }, { team_id: null }];
    assert.equal(appointmentsOfTeam(apts, "team-3").length, 1);
    assert.equal(appointmentsOfTeam(apts, ALL_TEAMS).length, 3);
  });

  test("сохранённая, но исчезнувшая команда возвращает ленту на «Все»", () => {
    assert.equal(liveTeamChoice("team-9", teams), ALL_TEAMS);
    assert.equal(liveTeamChoice(null, teams), ALL_TEAMS);
    assert.equal(liveTeamChoice("team-3", teams), "team-3");
  });

  test("тап включает команду, повторный тап снимает — снова все", () => {
    assert.equal(toggleTeamChoice(ALL_TEAMS, "team-1"), "team-1");
    assert.equal(toggleTeamChoice("team-1", "team-1"), ALL_TEAMS);
    assert.equal(toggleTeamChoice("team-1", "team-3"), "team-3");
  });

  test("новый клиент — в выбранную команду, из «Все» — в первую", () => {
    assert.equal(teamForNewClient("team-3", teams), "team-3");
    assert.equal(teamForNewClient(ALL_TEAMS, teams), "team-1");
    assert.equal(teamForNewClient("team-9", teams), "team-1");
    assert.equal(teamForNewClient(ALL_TEAMS, []), null);
  });
});
