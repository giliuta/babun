import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { settleGate } from "./settle-gate";

describe("settleGate", () => {
  test("отмена ждёт исход правки", async () => {
    const gate = settleGate();
    let undone = false;
    const undo = gate.settled.then((ok) => {
      if (ok) undone = true;
    });
    assert.equal(undone, false);
    gate.settle(true);
    await undo;
    assert.equal(undone, true);
  });
  test("сорвавшуюся правку не откатывают", async () => {
    const gate = settleGate();
    gate.settle(false);
    assert.equal(await gate.settled, false);
  });
});
