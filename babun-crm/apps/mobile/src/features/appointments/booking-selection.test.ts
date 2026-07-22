import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isServiceAllowedForTeam,
  reconcileBookingSelection,
} from "./booking-selection";

const services = [
  { id: "global", brigade_ids: [] },
  { id: "red-only", brigade_ids: ["red"] },
  { id: "blue-only", brigade_ids: ["blue"] },
];

describe("booking team invariants", () => {
  test("global service works for a selected team but scoped service does not work personally", () => {
    assert.equal(isServiceAllowedForTeam(services[0], "red"), true);
    assert.equal(isServiceAllowedForTeam(services[1], null), false);
  });

  test("switching team prunes stale services and incompatible master", () => {
    assert.deepEqual(
      reconcileBookingSelection({
        teamId: "blue",
        serviceIds: ["global", "red-only", "blue-only"],
        masterId: "red-master",
        services,
        masters: [
          { id: "red-master", team_id: "red" },
          { id: "floating", team_id: null },
        ],
      }),
      { serviceIds: ["global", "blue-only"], masterId: null },
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
