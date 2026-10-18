import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toJson } from "./json";

describe("toJson", () => {
  test("passes the value through unchanged", () => {
    const services = [{ id: "s1", qty: 2 }];
    assert.equal(toJson(services), services);
    assert.equal(toJson(null), null);
  });
});
