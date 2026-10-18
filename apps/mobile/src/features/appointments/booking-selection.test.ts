import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isServiceAllowedForTeam,
  reconcileBookingSelection,
  servicesBlockTeamMove,
} from "./booking-selection";

// Услуга принадлежит РОВНО одной команде: «услуги, доступные
// всем» больше нет, а запись без команды не предлагает никакого прайса.
const services = [
  { id: "red-only", team_id: "red" },
  { id: "blue-only", team_id: "blue" },
];

describe("booking team invariants", () => {
  test("услуга работает только у своей команды и никогда без команды", () => {
    assert.equal(isServiceAllowedForTeam(services[0], "red"), true);
    assert.equal(isServiceAllowedForTeam(services[0], "blue"), false);
    assert.equal(isServiceAllowedForTeam(services[0], null), false);
  });

  test("switching team prunes stale services and incompatible master", () => {
    assert.deepEqual(
      reconcileBookingSelection({
        teamId: "blue",
        serviceIds: ["red-only", "blue-only"],
        masterId: "red-master",
        services,
        masters: [
          { id: "red-master", team_id: "red" },
          { id: "floating", team_id: null },
        ],
      }),
      { serviceIds: ["blue-only"], masterId: null },
    );
  });

  test("своя строка записи переживает смену команды", () => {
    assert.deepEqual(
      reconcileBookingSelection({
        teamId: "blue",
        serviceIds: ["red-only", "custom:1", "blue-only"],
        masterId: null,
        services,
        masters: [],
      }).serviceIds,
      ["custom:1", "blue-only"],
    );
  });

  test("unassigned operational master is valid for any real team", () => {
    assert.equal(
      reconcileBookingSelection({
        teamId: "blue",
        serviceIds: [],
        masterId: "floating",
        services,
        masters: [{ id: "floating", team_id: null }],
      }).masterId,
      "floating",
    );
  });
});

describe("servicesBlockTeamMove", () => {
  const services = [
    { id: "a", team_id: "t1" },
    { id: "b", team_id: "t2" },
  ];
  test("услуга прайса старой команды держит запись", () => {
    assert.equal(servicesBlockTeamMove(["a"], services, "t2"), true);
  });
  test("услуги новой команды и свои строки — не держат", () => {
    assert.equal(servicesBlockTeamMove(["b"], services, "t2"), false);
    assert.equal(servicesBlockTeamMove([], services, "t2"), false);
  });
});
