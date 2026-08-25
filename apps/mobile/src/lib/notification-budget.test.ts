import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  IOS_BABUN_NOTIFICATION_BUDGET,
  PERSISTED_BABUN_NOTIFICATION_BUDGET,
  notificationOwnerDisposition,
  platformNotificationBudget,
  selectNotificationBudget,
  unmanagedLegacyNotificationIds,
} from "./notification-budget";

describe("local notification budget", () => {
  test("reserves iOS slots and keeps a bounded Android registry", () => {
    assert.equal(platformNotificationBudget("ios"), 60);
    assert.equal(platformNotificationBudget("android"), 256);
    assert.equal(IOS_BABUN_NOTIFICATION_BUDGET, 60);
    assert.equal(PERSISTED_BABUN_NOTIFICATION_BUDGET, 2_048);
  });

  test("keeps the nearest future reminders regardless of insertion order", () => {
    const selected = selectNotificationBudget(
      [
        { logicalId: "late", fireAt: 4_000 },
        { logicalId: "soon", fireAt: 2_000 },
        { logicalId: "middle", fireAt: 3_000 },
      ],
      2,
      1_000,
    );
    assert.deepEqual(
      selected.map((item) => item.logicalId),
      ["soon", "middle"],
    );
  });

  test("drops expired entries and uses the latest logical revision", () => {
    const selected = selectNotificationBudget(
      [
        { logicalId: "expired", fireAt: 900, revision: "old" },
        { logicalId: "same", fireAt: 2_000, revision: "old" },
        { logicalId: "same", fireAt: 3_000, revision: "new" },
      ],
      60,
      1_000,
    );
    assert.deepEqual(selected, [
      { logicalId: "same", fireAt: 3_000, revision: "new" },
    ]);
  });

  test("reports queued and hard-cap outcomes without claiming they are scheduled", () => {
    assert.equal(notificationOwnerDisposition(1, 1, 1), "scheduled");
    assert.equal(notificationOwnerDisposition(1, 1, 0), "deferred");
    assert.equal(notificationOwnerDisposition(2, 1, 1), "capacity");
  });

  test("never treats a shared-scheduler owner id as a legacy cancellation", () => {
    assert.deepEqual(
      unmanagedLegacyNotificationIds(
        ["old-native", "manual-owner", "old-native"],
        new Set(["manual-owner"]),
      ),
      ["old-native"],
    );
  });
});
