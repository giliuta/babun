import assert from "node:assert/strict";
import { test } from "node:test";
import { invitationShareUrl } from "./invitation-flow";

test("приглашение отправляют https-ссылкой: babun:// в мессенджерах Android не кликается", () => {
  const token = "a".repeat(40);
  assert.equal(invitationShareUrl(token), `https://babun.app/invite/${token}`);
  assert.throws(() => invitationShareUrl("bad token"));
});
