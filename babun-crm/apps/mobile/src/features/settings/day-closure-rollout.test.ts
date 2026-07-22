import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldImportLegacyDayClosure } from "./day-closure-rollout";

const openServer = { isClosed: false, revision: 0, actualCashCents: null };

describe("day closure rolling migration", () => {
  test("imports a known local actual amount into an empty server", () => {
    assert.equal(
      shouldImportLegacyDayClosure(
        openServer,
        { isClosed: true, revision: 1, actualCashCents: 12_345 },
        false,
      ),
      true,
    );
  });

  test("never invents cash for the legacy bare closed flag", () => {
    assert.equal(
      shouldImportLegacyDayClosure(
        openServer,
        { isClosed: true, revision: 1, actualCashCents: null },
        false,
      ),
      false,
    );
  });

  test("never resurrects a synced or explicitly reopened server day", () => {
    const knownLegacy = { isClosed: true, revision: 1, actualCashCents: 100 };
    assert.equal(
      shouldImportLegacyDayClosure(openServer, knownLegacy, true),
      false,
    );
    assert.equal(
      shouldImportLegacyDayClosure(
        { isClosed: false, revision: 2, actualCashCents: null },
        knownLegacy,
        false,
      ),
      false,
    );
  });
});
