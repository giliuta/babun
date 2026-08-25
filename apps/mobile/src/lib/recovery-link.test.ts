import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecoveryLink } from "./recovery-link";

describe("password recovery deep links", () => {
  test("parses legacy session tokens from a custom-scheme fragment", () => {
    assert.deepEqual(
      parseRecoveryLink(
        "babun://reset-password#access_token=access%201&refresh_token=refresh%202",
      ),
      {
        kind: "session",
        accessToken: "access 1",
        refreshToken: "refresh 2",
      },
    );
  });

  test("parses the token-hash recovery form from query or fragment", () => {
    assert.deepEqual(
      parseRecoveryLink("babundev://reset-password?token_hash=query-token"),
      { kind: "token-hash", tokenHash: "query-token" },
    );
    assert.deepEqual(
      parseRecoveryLink("babun://reset-password#token_hash=fragment-token"),
      { kind: "token-hash", tokenHash: "fragment-token" },
    );
  });

  test("rejects malformed and partial links instead of leaving a dead form", () => {
    assert.equal(parseRecoveryLink(null), null);
    assert.equal(parseRecoveryLink("not a url"), null);
    assert.equal(
      parseRecoveryLink("babun://reset-password#access_token=missing-refresh"),
      null,
    );
  });
});
