import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lastCreatedTeamId, lastTeamOfClient, recentClientIdsOf } from "./booking-history";

const row = (over: Partial<{
  team_id: string | null;
  created_at: string;
  client_id: string | null;
  date: string;
  time_start: string;
}>) => ({
  team_id: "t1",
  created_at: "2026-10-01T10:00:00Z",
  client_id: null,
  date: "2026-10-01",
  time_start: "10:00",
  ...over,
});

const teams = [{ id: "t1" }, { id: "t2" }];

describe("lastCreatedTeamId", () => {
  test("team of the most recently created record among live teams", () => {
    const appts = [
      row({ team_id: "t1", created_at: "2026-10-01T10:00:00Z" }),
      row({ team_id: "t2", created_at: "2026-10-02T10:00:00Z" }),
      row({ team_id: "gone", created_at: "2026-10-03T10:00:00Z" }),
      row({ team_id: null, created_at: "2026-10-04T10:00:00Z" }),
    ];
    assert.equal(lastCreatedTeamId(appts, teams), "t2");
  });

  test("nothing created yet → null", () => {
    assert.equal(lastCreatedTeamId([], teams), null);
  });
});

describe("recentClientIdsOf", () => {
  test("latest visits first (date, then start), unique, at most five", () => {
    const appts = [
      row({ client_id: "a", date: "2026-10-01", time_start: "09:00" }),
      row({ client_id: "b", date: "2026-10-03", time_start: "09:00" }),
      row({ client_id: "c", date: "2026-10-03", time_start: "12:00" }),
      row({ client_id: "b", date: "2026-10-02", time_start: "09:00" }),
      row({ client_id: null, date: "2026-10-09", time_start: "09:00" }),
      row({ client_id: "d", date: "2026-09-01" }),
      row({ client_id: "e", date: "2026-08-01" }),
      row({ client_id: "f", date: "2026-07-01" }),
    ];
    assert.deepEqual(recentClientIdsOf(appts), ["c", "b", "a", "d", "e"]);
  });
});

describe("lastTeamOfClient", () => {
  test("team of this client's latest visit, live teams only", () => {
    const appts = [
      row({ client_id: "a", team_id: "t1", date: "2026-10-01" }),
      row({ client_id: "a", team_id: "t2", date: "2026-10-05" }),
      row({ client_id: "a", team_id: "gone", date: "2026-10-09" }),
      row({ client_id: "b", team_id: "t1", date: "2026-10-10" }),
    ];
    assert.equal(lastTeamOfClient(appts, teams, "a"), "t2");
    assert.equal(lastTeamOfClient(appts, teams, "nobody"), null);
  });
});
