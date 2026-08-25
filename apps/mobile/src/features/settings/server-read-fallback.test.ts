import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isConfirmedNetworkUnavailable,
  isMissingCalendarSettingsContract,
  isMissingLoyaltySettingsContract,
  isMissingPersonalEventTypesContract,
  isMissingSmsTemplatesContract,
} from "./server-read-fallback";

describe("server read cache fallback", () => {
  test("recognizes transport failures", () => {
    assert.equal(
      isConfirmedNetworkUnavailable({ message: "TypeError: Network request failed" }),
      true,
    );
    assert.equal(
      isConfirmedNetworkUnavailable({ code: "NETWORK_ERROR" }),
      true,
    );
  });

  test("does not hide RLS, validation or database errors", () => {
    assert.equal(
      isConfirmedNetworkUnavailable({ code: "42501", message: "row-level security" }),
      false,
    );
    assert.equal(
      isConfirmedNetworkUnavailable({ code: "23505", message: "duplicate key" }),
      false,
    );
    assert.equal(
      isConfirmedNetworkUnavailable({ code: "PGRST116", message: "JSON object requested" }),
      false,
    );
  });

  test("recognizes only rolling-deploy calendar contract gaps", () => {
    assert.equal(
      isMissingCalendarSettingsContract({
        code: "PGRST202",
        message:
          "Could not find the function public.read_operational_calendar_settings_safe in the schema cache",
      }),
      true,
    );
    assert.equal(
      isMissingCalendarSettingsContract({
        code: "PGRST205",
        message: "Could not find the table public.calendar_settings",
      }),
      true,
    );
    assert.equal(
      isMissingCalendarSettingsContract({
        code: "42501",
        message: "permission denied for table calendar_settings",
      }),
      false,
    );
    assert.equal(
      isMissingCalendarSettingsContract({
        code: "22023",
        message: "invalid calendar settings",
      }),
      false,
    );
  });

  test("recognizes rolling-deploy gaps for other cached settings tables", () => {
    assert.equal(
      isMissingLoyaltySettingsContract({
        code: "PGRST205",
        message: "Could not find the table public.tenant_loyalty_settings",
      }),
      true,
    );
    assert.equal(
      isMissingPersonalEventTypesContract({
        code: "42P01",
        message: 'relation "personal_event_types" does not exist',
      }),
      true,
    );
    for (const error of [
      { code: "42501", message: "permission denied" },
      { code: "23505", message: "duplicate key" },
      { code: "22023", message: "invalid settings" },
    ]) {
      assert.equal(isMissingLoyaltySettingsContract(error), false);
      assert.equal(isMissingPersonalEventTypesContract(error), false);
    }
  });

  test("recognizes only a missing SMS-template RPC contract", () => {
    assert.equal(
      isMissingSmsTemplatesContract({
        code: "PGRST202",
        message:
          "Could not find the function public.read_sms_templates_safe in the schema cache",
      }),
      true,
    );
    assert.equal(
      isMissingSmsTemplatesContract({
        code: "42883",
        message: "function public.write_sms_templates_safe(jsonb) does not exist",
      }),
      true,
    );
    for (const error of [
      { code: "42501", message: "sms templates require owner access" },
      { code: "22023", message: "sms templates payload is invalid" },
      { code: "23505", message: "duplicate key" },
    ]) {
      assert.equal(isMissingSmsTemplatesContract(error), false);
    }
  });
});
