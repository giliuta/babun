import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const edgeSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/send_sms/index.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720210013_sms_dispatch_hardening.sql",
  ),
  "utf8",
);

describe("send_sms authorization and credit contracts", () => {
  test("requires an owner membership for test sends", () => {
    assert.match(edgeSource, /authorizeOwnerTestSend/);
    assert.match(edgeSource, /supabase\.auth\.getUser\(token\)/);
    assert.match(edgeSource, /\.eq\("user_id", userId\)/);
    assert.match(edgeSource, /\.eq\("role", "owner"\)/);
    assert.match(edgeSource, /owner_authorization_required/);
  });

  test("requires the database-held cron secret for sweeps", () => {
    assert.match(edgeSource, /authorizeCronSweep/);
    assert.match(edgeSource, /request\.headers\.get\("x-cron-secret"\)/);
    assert.match(edgeSource, /\.from\("edge_cron_secrets"\)/);
    assert.match(edgeSource, /constantTimeEqual\(supplied, data\.secret\)/);
    assert.match(edgeSource, /cron_authorization_required/);

    assert.match(migrationSource, /force row level security/i);
    assert.match(
      migrationSource,
      /revoke all on table public\.edge_cron_secrets\s+from public, anon, authenticated/i,
    );
    assert.match(migrationSource, /'x-cron-secret'/);
  });

  test("reserves credit atomically before Twilio and releases on failure", () => {
    const sweep = edgeSource.slice(edgeSource.indexOf("for (const apt of"));
    const reserveAt = sweep.indexOf("await reserveSmsCredit");
    const sendAt = sweep.indexOf("const result = await twilioSend");
    assert.ok(reserveAt >= 0 && sendAt > reserveAt);
    assert.match(sweep, /await releaseSmsCredit/);

    assert.match(migrationSource, /for update/i);
    assert.match(
      migrationSource,
      /free_sms_remaining = config\.free_sms_remaining - 1/,
    );
    assert.match(migrationSource, /balance_cents = config\.balance_cents - 10/);
    assert.match(
      migrationSource,
      /grant execute on function public\.reserve_sms_credit\(uuid\) to service_role/i,
    );
  });
});
