import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { durationLabel, tierSentence } from "./format";

describe("service wording", () => {
  test("duration speaks hours and minutes the way people say them", () => {
    assert.equal(durationLabel(45), "45 мин");
    assert.equal(durationLabel(60), "1 ч");
    assert.equal(durationLabel(90), "1 ч 30 мин");
    assert.equal(durationLabel(0), "0 мин");
  });

  test("a tier reads aloud as one sentence", () => {
    assert.equal(
      tierSentence({
        minQuantity: "3",
        rowPrice: "135",
        totalDuration: "240",
      }),
      "от 3 — €135 · 4 ч на всё",
    );
    // Половины необязательны по отдельности: фраза печатает то, что вписано.
    assert.equal(
      tierSentence({ minQuantity: "5", rowPrice: "40", totalDuration: "" }),
      "от 5 — €40",
    );
    assert.equal(
      tierSentence({ minQuantity: "", rowPrice: "", totalDuration: "" }),
      "от …",
    );
  });
});
