import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/send_sms/index.ts"),
  "utf8",
);

describe("send_sms appointment opt-in contract", () => {
  test("selects and requires reminder_enabled=true", () => {
    assert.match(
      source,
      /id,tenant_id,client_id,team_id,date,time_start,reminder_enabled/,
    );
    assert.match(source, /\.eq\("reminder_enabled", true\)/);
    // Equality to true is fail-closed for false and legacy/null rows.
    assert.doesNotMatch(source, /\.neq\("reminder_enabled", false\)/);
  });

  test("keeps per-appointment and per-trigger idempotency", () => {
    assert.match(source, /\.eq\("appointment_id", apt\.id\)/);
    assert.match(source, /\.eq\("trigger_type", trigger\)/);
    assert.match(
      source,
      /partial UNIQUE on \(appointment_id, trigger_type\)/,
    );
    const sweep = source.slice(source.indexOf("for (const apt of"));
    const claimAt = sweep.indexOf('status: "queued"');
    const sendAt = sweep.indexOf("const result = await twilioSend");
    assert.ok(claimAt >= 0 && sendAt > claimAt, "claim must precede Twilio");
    assert.match(sweep, /claimError\?\.code === "23505"/);
    assert.match(sweep, /const claimId = stringField\(claim, "id"\)/);
    assert.match(sweep, /\.eq\("id", claimId\)/);
  });

  test("uses tenant/team IANA timezones instead of one hard-coded zone", () => {
    assert.match(source, /\.from\("calendar_settings"\)/);
    assert.match(source, /\.from\("teams"\)/);
    assert.match(source, /timeZoneByTeam\.get\(apt\.team_id\)/);
    assert.match(
      source,
      /tenantLocalToUtc\(\s*apt\.date,\s*apt\.time_start,\s*appointmentTimeZone/,
    );
    assert.doesNotMatch(source, /const TENANT_TZ\s*=/);
  });

  test("test-send writes the actual sms_messages and sms_logs schemas", () => {
    const testSend = source.slice(
      source.indexOf("async function handleTestSend"),
      source.indexOf("Deno.serve"),
    );
    assert.match(testSend, /message_body: message/);
    assert.match(testSend, /body: message/);
    assert.match(testSend, /sender_name_used: sender/);
    assert.match(testSend, /twilio_message_sid: send\.sid/);
    assert.doesNotMatch(testSend, /body_preview|sent_at/);
  });
});
