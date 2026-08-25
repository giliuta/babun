import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldBlockUnresolvedTenant } from "./dashboard-gate-policy";

describe("dashboard gate policy", () => {
  test("blocks a cold unknown membership instead of mounting a stuck role gate", () => {
    assert.equal(
      shouldBlockUnresolvedTenant({ status: "unknown", tenantId: null }),
      true,
    );
  });

  test("keeps the offline fail-open path for a known tenant", () => {
    assert.equal(
      shouldBlockUnresolvedTenant({
        status: "unknown",
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
      false,
    );
    assert.equal(
      shouldBlockUnresolvedTenant({
        status: "onboarded",
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
      false,
    );
  });
});
