import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readableForeground } from "./readable-color";

describe("readableForeground", () => {
  it("uses dark ink on bright system avatar colors", () => {
    assert.equal(readableForeground("#FFCC00"), "#0b1220");
    assert.equal(readableForeground("#34C759"), "#0b1220");
  });

  it("chooses the higher-contrast foreground on saturated colors", () => {
    assert.equal(readableForeground("#5E5CE6"), "#ffffff");
    assert.equal(readableForeground("#AF52DE"), "#0b1220");
  });

  it("fails safely for a non-solid color", () => {
    assert.equal(readableForeground("transparent"), "#0b1220");
  });
});
