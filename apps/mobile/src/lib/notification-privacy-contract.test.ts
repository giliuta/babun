import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("notification privacy contract", () => {
  test("clears native notifications before tenant-scoped caches", () => {
    const source = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    assert.match(
      source,
      /await clearAllBabunNotifications\(\);[\s\S]*wipeFastStores\(\)/,
    );
  });

  test("suspends native PII delivery for every signed-out startup without erasing transient state", () => {
    const authSource = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    const notificationSource = readFileSync(
      resolve(here, "notifications.ts"),
      "utf8",
    );
    const sessionSource = readFileSync(
      resolve(here, "../providers/SessionProvider.tsx"),
      "utf8",
    );
    assert.match(
      authSource,
      /event === "SIGNED_OUT"[\s\S]*await suspendAllBabunNotifications\(\)/,
    );
    assert.match(
      authSource,
      /event === "INITIAL_SESSION" && !session[\s\S]*await suspendAllBabunNotifications\(\)/,
    );
    assert.match(
      notificationSource,
      /suspendAllBabunNotifications[\s\S]*enqueueScheduler\(clearNativeNotificationsLocked\)/,
    );
    assert.match(
      sessionSource,
      /\.catch\(\(\) => \{[\s\S]*applySession\("INITIAL_SESSION", null\)/,
    );
  });

  test("wipes legacy calendar keys and keeps new reminder registries scoped", () => {
    const authSource = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    const reminderSource = readFileSync(
      resolve(here, "../features/clients/reminders.ts"),
      "utf8",
    );
    assert.match(authSource, /"calendar\."/);
    assert.match(
      reminderSource,
      /CLIENT_REMINDER_IDS_KEY = "babun:clients\.reminderNotificationIds\.v1"/,
    );
  });

  test("configures native notification entitlements for dev and TestFlight", () => {
    const appConfig = readFileSync(resolve(here, "../../app.config.js"), "utf8");
    assert.match(appConfig, /"expo-notifications"/);
    assert.match(
      appConfig,
      /mode: IS_DEV \? "development" : "production"/,
    );
  });

  test("presents reminders while the dispatcher keeps Babun open", () => {
    const source = readFileSync(resolve(here, "notifications.ts"), "utf8");
    assert.match(source, /setNotificationHandler/);
    assert.match(source, /shouldShowBanner: true/);
    assert.match(source, /shouldShowList: true/);
  });
});
