import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isServiceAllowedForTeam,
  reconcileBookingSelection,
} from "./booking-selection";

// Услуга принадлежит РОВНО одной команде (2026-08-17): «услуги, доступные
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
