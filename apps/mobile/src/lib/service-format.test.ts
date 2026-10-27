import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { durationLabel } from "./service-format";

describe("service wording", () => {
  test("duration speaks hours and minutes the way people say them", () => {
    assert.equal(durationLabel(45), "45 мин");
    assert.equal(durationLabel(60), "1 ч");
    assert.equal(durationLabel(90), "1 ч 30 мин");
    assert.equal(durationLabel(0), "0 мин");
  });
});
