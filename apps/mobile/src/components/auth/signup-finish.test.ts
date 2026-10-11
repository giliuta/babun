import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mayFinishHere, signupFinish } from "./signup-finish";

describe("дорегистрация после единого входа", () => {
  test("вход через Google: пароля нет — спросить его, имя из Google", () => {
    assert.deepEqual(
      signupFinish({
        identities: [{ provider: "google" }],
        user_metadata: { full_name: " Artem Giliuta ", name: "Artem" },
      }),
      { needed: true, needsPassword: true, suggestedName: "Artem Giliuta" },
    );
  });

  test("пароль уже придуман — экран не нужен", () => {
    assert.equal(
      signupFinish({ identities: [{ provider: "apple" }], user_metadata: { password_set: true } }).needed,
      false,
    );
  });

  test("обычный аккаунт почтой — экран не нужен", () => {
    assert.deepEqual(signupFinish({ identities: [{ provider: "email" }], user_metadata: {} }), {
      needed: false,
      needsPassword: false,
      suggestedName: "",
    });
  });

  test("Google привязан к аккаунту почтой — пароль у него уже есть", () => {
    assert.equal(
      signupFinish({ identities: [{ provider: "email" }, { provider: "google" }], user_metadata: {} })
        .needsPassword,
      false,
    );
  });

  test("регистрация почтой с экрана входа — спросить только имя", () => {
    assert.deepEqual(
      signupFinish({ identities: [{ provider: "email" }], user_metadata: { finish_pending: true } }),
      { needed: true, needsPassword: false, suggestedName: "" },
    );
  });

  test("сессии нет — ничего не нужно", () => {
    assert.equal(signupFinish(null).needed, false);
  });
});

describe("на iPhone новый аккаунт не заводится", () => {
  test("без приглашения и чужих команд — нельзя", () => {
    assert.equal(mayFinishHere({ canSignUpHere: false, hasPendingInvitation: false, roles: ["owner"] }), false);
  });
  test("по приглашению или уже в чужой команде — можно", () => {
    assert.equal(mayFinishHere({ canSignUpHere: false, hasPendingInvitation: true, roles: [] }), true);
    assert.equal(mayFinishHere({ canSignUpHere: false, hasPendingInvitation: false, roles: ["owner", "master"] }), true);
  });
  test("на сайте и в Android — всегда можно", () => {
    assert.equal(mayFinishHere({ canSignUpHere: true, hasPendingInvitation: false, roles: [] }), true);
  });
});
