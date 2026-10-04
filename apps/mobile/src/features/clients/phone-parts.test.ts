import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { phoneParts } from "./phone";

describe("код страны отдельно, цифры отдельно", () => {
  test("кипрский номер — «+357» и группы", () => {
    assert.deepEqual(phoneParts("+357 97469998", "CY"), { code: "+357", rest: "97 469 998" });
    assert.deepEqual(phoneParts("97469998", "CY"), { code: "+357", rest: "97 469 998" });
  });
  test("чужой номер — свой код", () => {
    const p = phoneParts("+44 7700 900123", "CY");
    assert.equal(p.code, "+44");
    assert.equal(p.rest, "7700 900123");
  });
  test("пусто — код страны компании", () => {
    assert.deepEqual(phoneParts("", "CY"), { code: "+357", rest: "" });
  });
});
