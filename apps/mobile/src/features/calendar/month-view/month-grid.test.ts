import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { groupByDate, monthCells, ymd } from "./month-grid";

describe("month grid", () => {
  test("ymd is the local calendar date", () => {
    assert.equal(ymd(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("42 cells starting on the week day that holds the 1st", () => {
    // October 2026 starts on a Thursday: Monday-first grid opens on 28 September.
    const cells = monthCells(new Date(2026, 9, 1));
    assert.equal(cells.length, 42);
    assert.equal(ymd(cells[0]), "2026-09-28");
    assert.equal(ymd(cells[3]), "2026-10-01");
    assert.equal(ymd(cells[41]), "2026-11-08");
  });

  test("records grouped by their date", () => {
    const a = (id: string, date: string) => ({ id, date }) as Appointment;
    const map = groupByDate([a("1", "2026-10-01"), a("2", "2026-10-02"), a("3", "2026-10-01")]);
    assert.deepEqual(map.get("2026-10-01")?.map((x) => x.id), ["1", "3"]);
    assert.equal(map.get("2026-10-03"), undefined);
  });
});
