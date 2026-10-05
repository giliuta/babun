import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { emailLinkOtpType, parseRecoveryLink, recoveryLinkKey } from "./recovery-link";

const here = dirname(fileURLToPath(import.meta.url));

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

describe("ссылка сброса меняет пароль своему человеку (аудит 03.10)", () => {
  test("отпечаток ссылки: та же — тот же, другая — другой", () => {
    const a = parseRecoveryLink("babun://reset-password#token_hash=aaa")!;
    const b = parseRecoveryLink("babun://reset-password?token_hash=bbb")!;
    assert.equal(recoveryLinkKey(a), recoveryLinkKey(parseRecoveryLink("babun://reset-password?token_hash=aaa")!));
    assert.notEqual(recoveryLinkKey(a), recoveryLinkKey(b));
  });

  test("живая сессия не заменяет проверку ссылки", () => {
    const screen = readFileSync(resolve(here, "../../app/(auth)/reset-password.tsx"), "utf8");
    const hydrate = screen.slice(screen.indexOf("async function hydrate()"), screen.indexOf("void hydrate();"));
    const firstSession = hydrate.indexOf("getSession()");
    const parse = hydrate.indexOf("parseRecoveryLink(");
    assert.ok(parse >= 0, "ссылка читается");
    assert.ok(firstSession > parse, "сессия спрашивается только после ссылки");
    assert.ok(hydrate.indexOf("verifiedRecoveryLinks.has(key)") < firstSession);
  });

  test("вход по ссылке сброса проходит сверку человека", () => {
    const authClear = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    const handler = authClear.slice(authClear.indexOf("export async function handleAuthEvent("));
    const guard = handler.slice(0, handler.indexOf("const next = session?.user?.id;"));
    assert.match(guard, /event !== "PASSWORD_RECOVERY"/);
  });
});

// Письма подтверждения и входа по коду ведут на babun.app/login?token_hash=…
// (04.10): тип ключа берётся из ссылки, неизвестный — «email».
describe("тип ключа из ссылки письма", () => {
  test("type из адреса, по умолчанию email", () => {
    assert.equal(emailLinkOtpType("https://babun.app/login?token_hash=abc&type=email"), "email");
    assert.equal(emailLinkOtpType("https://babun.app/login?token_hash=abc&type=magiclink"), "magiclink");
    assert.equal(emailLinkOtpType("https://babun.app/login?token_hash=abc&type=recovery"), "email");
    assert.equal(emailLinkOtpType("https://babun.app/login?token_hash=abc"), "email");
    assert.equal(emailLinkOtpType(null), "email");
  });
  test("ключ из ссылки распознаётся как одноразовый", () => {
    assert.deepEqual(parseRecoveryLink("https://babun.app/login?token_hash=abc&type=email"), {
      kind: "token-hash",
      tokenHash: "abc",
    });
  });
});
