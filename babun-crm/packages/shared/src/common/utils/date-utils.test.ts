import { describe, expect, test } from "bun:test";
import { zonedWallTimeToInstant } from "./date-utils";

describe("zonedWallTimeToInstant", () => {
  test("uses the requested business timezone, not the device wall clock", () => {
    const newYork = zonedWallTimeToInstant(
      "2026-07-20",
      "10:00",
      "America/New_York",
    );
    const nicosia = zonedWallTimeToInstant(
      "2026-07-20",
      "10:00",
      "Europe/Nicosia",
    );

    expect(newYork.toISOString()).toBe("2026-07-20T14:00:00.000Z");
    expect(nicosia.toISOString()).toBe("2026-07-20T07:00:00.000Z");
  });

  test("shifts a nonexistent spring-DST wall time forward by the gap", () => {
    expect(
      zonedWallTimeToInstant(
        "2026-03-08",
        "02:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  test("chooses the earlier instant in a repeated fall-DST hour", () => {
    expect(
      zonedWallTimeToInstant(
        "2026-11-01",
        "01:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  test("rejects invalid calendar fields and invalid IANA zones", () => {
    expect(() =>
      zonedWallTimeToInstant("2026-02-30", "10:00", "Europe/Nicosia"),
    ).toThrow();
    expect(() =>
      zonedWallTimeToInstant("2026-07-20", "10:00", "Mars/Olympus"),
    ).toThrow();
  });
});
