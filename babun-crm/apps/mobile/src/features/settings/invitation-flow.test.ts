import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  invitationErrorMessage,
  invitationPath,
  invitationShareText,
  isInvitableRole,
  isInvitationEmail,
  isInvitationToken,
  normalizeInvitationEmail,
} from "./invitation-flow";

describe("mobile invitation flow", () => {
  test("accepts exact 192-bit URL-safe tokens and rejects weak links", () => {
    const token = "AbCdEf0123456789_-AbCdEf01234567";
    assert.equal(token.length, 32);
    assert.equal(isInvitationToken(token), true);
    assert.equal(invitationPath(token), `/invite/${token}`);
    assert.equal(isInvitationToken("short-token"), false);
    assert.equal(isInvitationToken(`${token}!`), false);
  });

  test("normalizes email and limits invitations to operational roles", () => {
    assert.equal(normalizeInvitationEmail("  USER@Example.COM "), "user@example.com");
    assert.equal(isInvitationEmail("user@example.com"), true);
    assert.equal(isInvitationEmail("owner@localhost"), false);
    assert.equal(isInvitableRole("dispatcher"), true);
    assert.equal(isInvitableRole("master"), true);
    assert.equal(isInvitableRole("owner"), false);
  });

  test("renders a signed mobile share message and friendly failures", () => {
    const text = invitationShareText({
      tenantName: "AirFix",
      roleLabel: "Бригадир / мастер",
      url: "babun://invite/token",
    });
    assert.match(text, /AirFix/);
    assert.match(text, /Бригадир \/ мастер/);
    assert.match(text, /babun:\/\/invite\/token/);
    assert.match(
      invitationErrorMessage("invitation email does not match"),
      /другой email/,
    );
    assert.match(invitationErrorMessage("invitation expired"), /истёк/);
    assert.match(
      invitationErrorMessage("finish company setup before inviting employees"),
      /завершите настройку компании/,
    );
  });
});
