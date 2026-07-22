import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const migrationNames = readdirSync(
  resolve(process.cwd(), "supabase/migrations"),
).filter((name) => name.endsWith(".sql"));

describe("2026-07-20 Supabase release migration versions", () => {
  test("uses one CLI-visible 14-digit version per release migration", () => {
    const obsoleteBatchNames = migrationNames.filter((name) =>
      /^20260720_\d{3}_/.test(name)
    );
    assert.deepEqual(obsoleteBatchNames, []);

    const releaseNames = migrationNames.filter((name) =>
      /^20260720\d{6}_/.test(name)
    );
    assert.equal(releaseNames.length, 16);

    const versions = releaseNames.map((name) => name.split("_", 1)[0]);
    assert.equal(new Set(versions).size, releaseNames.length);
    for (const version of versions) assert.match(version, /^\d{14}$/);
  });
});
