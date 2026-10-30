import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasVerifiedTotp, needsSecondStep, tokenLevel } from "./assurance";

/** Токен с нужной полезной нагрузкой; подпись серверу тут не нужна. */
const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

const totp = (status: "verified" | "unverified") => ({ factor_type: "totp", status });

describe("двухфакторный вход: нужен ли второй шаг", () => {
  test("уровень читается из токена, кривой токен — не уровень", () => {
    assert.equal(tokenLevel(jwt({ aal: "aal1" })), "aal1");
    assert.equal(tokenLevel(jwt({ aal: "aal2" })), "aal2");
    assert.equal(tokenLevel(jwt({ sub: "x" })), null);
    assert.equal(tokenLevel("не.токен"), null);
    assert.equal(tokenLevel(null), null);
  });

  test("пароль при включённом двухфакторном входе — нужен код", () => {
    assert.equal(
      needsSecondStep({ access_token: jwt({ aal: "aal1" }), user: { factors: [totp("verified")] } }),
      true,
    );
  });

  test("после кода — второй уровень, в приложение пускаем", () => {
    assert.equal(
      needsSecondStep({ access_token: jwt({ aal: "aal2" }), user: { factors: [totp("verified")] } }),
      false,
    );
  });

  test("без подтверждённого фактора код не спрашиваем", () => {
    assert.equal(needsSecondStep({ access_token: jwt({ aal: "aal1" }), user: { factors: [] } }), false);
    assert.equal(
      needsSecondStep({ access_token: jwt({ aal: "aal1" }), user: { factors: [totp("unverified")] } }),
      false,
    );
    assert.equal(needsSecondStep({ access_token: jwt({ aal: "aal1" }), user: {} }), false);
  });

  test("нет сессии или непонятный уровень — снаружи не запираем", () => {
    assert.equal(needsSecondStep(null), false);
    assert.equal(
      needsSecondStep({ access_token: jwt({ sub: "x" }), user: { factors: [totp("verified")] } }),
      false,
    );
  });

  test("фактор не TOTP двухфакторный вход не включает", () => {
    assert.equal(hasVerifiedTotp({ user: { factors: [{ factor_type: "phone", status: "verified" }] } }), false);
  });
});
