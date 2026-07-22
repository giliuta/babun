import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isQueuedOpVisibleForTenant } from "./sync-queue-policy";

describe("sync queue tenant privacy", () => {
  test("hides an explicitly foreign tenant operation", () => {
    assert.equal(
      isQueuedOpVisibleForTenant(
        { payload: { tenant_id: "tenant-b", full_name: "private" } },
        "tenant-a",
      ),
      false,
    );
    assert.equal(
      isQueuedOpVisibleForTenant(
        { payload: { tenant_id: "tenant-a" } },
        null,
      ),
      false,
    );
  });

  test("keeps active and legacy operations actionable", () => {
    assert.equal(
      isQueuedOpVisibleForTenant(
        { payload: { tenant_id: "tenant-a" } },
        "tenant-a",
      ),
      true,
    );
    assert.equal(
      isQueuedOpVisibleForTenant({ payload: { status: "done" } }, "tenant-a"),
      true,
    );
  });
});
