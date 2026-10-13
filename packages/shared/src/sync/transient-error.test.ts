import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isTransientNetworkError } from "./transient-error";

describe("isTransientNetworkError", () => {
  test("fetch failures of every runtime are transient", () => {
    for (const message of ["Failed to fetch", "Load failed", "Network request failed"]) {
      assert.equal(isTransientNetworkError(new TypeError(message)), true, message);
    }
  });

  test("gateway 5xx is transient by status and by wording", () => {
    assert.equal(isTransientNetworkError({ status: 503, message: "x" }), true);
    assert.equal(isTransientNetworkError({ statusCode: 502 }), true);
    assert.equal(isTransientNetworkError(new Error("502 Bad Gateway")), true);
  });

  test("a plain error object is read by its message", () => {
    assert.equal(isTransientNetworkError({ message: "request timed out" }), true);
  });

  test("server rejections are not transient", () => {
    assert.equal(
      isTransientNetworkError({ status: 403, message: "new row violates row-level security policy" }),
      false,
    );
    assert.equal(isTransientNetworkError(new Error("duplicate key value")), false);
  });
});
