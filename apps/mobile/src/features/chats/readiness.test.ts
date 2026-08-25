import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isMessagingReady,
  MESSAGING_READINESS,
  MessagingUnavailableError,
  requireMessagingReady,
} from "./readiness";

const here = dirname(fileURLToPath(import.meta.url));

describe("messaging production-readiness gate", () => {
  test("requires the complete server and provider contract", () => {
    assert.equal(isMessagingReady(), false);
    assert.equal(Object.keys(MESSAGING_READINESS).length, 7);
    assert.equal(
      isMessagingReady({
        ...MESSAGING_READINESS,
        conversationSchema: true,
        tenantRls: true,
        realtimeSync: true,
        outboundProviderDelivery: true,
        inboundSignedWebhooks: true,
        providerIdentityMapping: true,
        mediaStorage: true,
      }),
      true,
    );
  });

  test("fails closed instead of accepting a device-local send", () => {
    assert.throws(
      () => requireMessagingReady(),
      (error: unknown) =>
        error instanceof MessagingUnavailableError &&
        error.code === "messaging_not_ready",
    );

    const store = readFileSync(resolve(here, "store.ts"), "utf8");
    assert.match(store, /DEVICE_LOCAL_CHAT_TRANSPORT_ENABLED = false/);
    assert.match(store, /requireMessagingReady\(\)/);
    assert.match(store, /enabled: canHydratePrototype/);
  });

  test("does not mistake outbound SMS audit rows for a conversation backend", () => {
    // Репозиторий переехал в одну папку 2026-08-25: веб-приложения больше
    // нет, миграции лежат в корне. Путь чинится здесь, а не отключением
    // теста: он стережёт обещание «чаты работают», и молчащий сторож хуже
    // отсутствующего.
    const migrationsDir = resolve(here, "../../../../../supabase/migrations");
    const sql = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
      .join("\n");

    assert.doesNotMatch(
      sql,
      /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.(?:conversations|chat_messages)\b/i,
    );
    assert.match(sql, /create\s+table\s+public\.sms_messages\b/i);
  });
});
