import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareRow, deltaOf, monthTrend } from "./compare-rows";

const colors = { success: "green", danger: "red" };

describe("deltaOf", () => {
  test("growth is good when goodUp, bad otherwise", () => {
    assert.deepEqual(deltaOf(150, 100, true, colors), { text: "↑ 50%", color: "green" });
    assert.deepEqual(deltaOf(150, 100, false, colors), { text: "↑ 50%", color: "red" });
  });

  test("a drop shows the absolute percent with a down arrow", () => {
    assert.deepEqual(deltaOf(50, 100, true, colors), { text: "↓ 50%", color: "red" });
    assert.deepEqual(deltaOf(50, 100, false, colors), { text: "↓ 50%", color: "green" });
  });

  test("no base or no change — no delta", () => {
    assert.equal(deltaOf(10, 0, true, colors), null);
    assert.equal(deltaOf(100, 100, true, colors), null);
  });
});

describe("compareRow", () => {
  test("formats both sides and shares against the larger one", () => {
    const row = compareRow("income", "Доход", 50, 100, (v) => `€${v}`, "c", colors);
    assert.equal(row.now, "€50");
    assert.equal(row.before, "€100");
    assert.equal(row.share, 0.5);
    assert.deepEqual(row.delta, { text: "↓ 50%", color: "red" });
  });

  test("negative now never draws a bar; nothing at all — zero share", () => {
    assert.equal(compareRow("p", "P", -20, 10, String, "c", colors).share, 0);
    assert.equal(compareRow("p", "P", 0, 0, String, "c", colors).share, 0);
  });

  test("goodUp=false flips the colour of growth", () => {
    const row = compareRow("expense", "Расход", 200, 100, String, "c", colors, false);
    assert.deepEqual(row.delta, { text: "↑ 100%", color: "red" });
  });
});

describe("monthTrend", () => {
  test("newest first, each month against the one before it", () => {
    const rows = monthTrend(
      [
        { key: "2026-01", profit: 100 },
        { key: "2026-02", profit: 150 },
        { key: "2026-03", profit: 150 },
      ],
      colors,
    );
    assert.deepEqual(rows.map((r) => r.key), ["2026-03", "2026-02", "2026-01"]);
    assert.equal(rows[0].delta, null);
    assert.deepEqual(rows[1].delta, { text: "↑ 50%", color: "green" });
    assert.equal(rows[2].delta, null);
  });
});
