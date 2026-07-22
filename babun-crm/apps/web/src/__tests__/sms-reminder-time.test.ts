import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  dateKeyInTimeZone,
  isValidTimeZone,
  resolveTenantTimeZone,
  tenantLocalToUtc,
} from "../../supabase/functions/send_sms/time";

describe("send_sms timezone helpers", () => {
  test("keeps quarter-hour IANA offsets", () => {
    assert.equal(
      tenantLocalToUtc(
        "2026-07-20",
        "10:00",
        "Asia/Kathmandu",
      )?.toISOString(),
      "2026-07-20T04:15:00.000Z",
    );
    assert.equal(
      tenantLocalToUtc(
        "2026-07-20",
        "10:00",
        "Asia/Kolkata",
      )?.toISOString(),
      "2026-07-20T04:30:00.000Z",
    );
  });

  test("uses the earlier instant during a fall DST overlap", () => {
    assert.equal(
      tenantLocalToUtc(
        "2026-11-01",
        "01:30",
        "America/New_York",
      )?.toISOString(),
      "2026-11-01T05:30:00.000Z",
    );
  });

  test("moves a nonexistent spring-DST wall time forward by the gap", () => {
    assert.equal(
      tenantLocalToUtc(
        "2026-03-08",
        "02:30",
        "America/New_York",
      )?.toISOString(),
      "2026-03-08T07:30:00.000Z",
    );
  });

  test("formats the candidate date in each business timezone", () => {
    const instant = new Date("2026-07-20T22:30:00.000Z");
    assert.equal(dateKeyInTimeZone(instant, "Europe/Nicosia"), "2026-07-21");
    assert.equal(dateKeyInTimeZone(instant, "America/New_York"), "2026-07-20");
    assert.equal(isValidTimeZone("Not/AZone"), false);
  });

  test("defaults a missing tenant setting but rejects an invalid one", () => {
    assert.equal(resolveTenantTimeZone(null), "Europe/Nicosia");
    assert.equal(resolveTenantTimeZone(""), "Europe/Nicosia");
    assert.equal(resolveTenantTimeZone("Not/AZone"), null);
  });
});
