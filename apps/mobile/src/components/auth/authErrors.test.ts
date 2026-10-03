import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mapAuthError, signUpHitExistingAccount } from "./authErrors";

describe("регистрация на занятый email", () => {
  test("пустые identities без сессии — адрес занят, письма не будет", () => {
    assert.equal(signUpHitExistingAccount({ user: { identities: [] }, session: null }), true);
    assert.equal(
      mapAuthError({ code: "user_already_exists" }, "signup"),
      "Этот email уже зарегистрирован — войдите",
    );
  });

  test("новый адрес и вход без подтверждения — обычный путь", () => {
    assert.equal(signUpHitExistingAccount({ user: { identities: [{}] }, session: null }), false);
    assert.equal(signUpHitExistingAccount({ user: { identities: [] }, session: {} }), false);
    assert.equal(signUpHitExistingAccount({ user: null, session: null }), false);
    // Старый GoTrue без поля — не гадаем.
    assert.equal(signUpHitExistingAccount({ user: {}, session: null }), false);
  });
});
