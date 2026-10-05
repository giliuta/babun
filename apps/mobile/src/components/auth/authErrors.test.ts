import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mapAuthError } from "./authErrors";

// Отказы GoTrue — словами человека, без английского и без «Нет связи» на
// ошибке, которая не про сеть (04.10, перед выпуском в магазины).
describe("ошибки входа и регистрации", () => {
  test("опечатка в адресе называется опечаткой", () => {
    assert.equal(
      mapAuthError({ code: "email_address_invalid", message: 'Email address "a@b" is invalid' }, "signup"),
      "Проверьте адрес почты",
    );
    assert.equal(
      mapAuthError({ code: "validation_failed", message: "Unable to validate email address: invalid format" }, "send"),
      "Проверьте адрес почты",
    );
  });

  test("письмо не ушло — так и сказано; лимит — лимит", () => {
    assert.equal(
      mapAuthError({ code: "unexpected_failure", message: "Error sending recovery email" }, "send"),
      "Не удалось отправить письмо. Попробуйте ещё раз",
    );
    assert.equal(
      mapAuthError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "send"),
      "Слишком много попыток, подождите минуту",
    );
  });

  test("код, утёкший пароль, неверный пароль", () => {
    assert.equal(
      mapAuthError({ code: "otp_expired", message: "Token has expired or is invalid" }, "code"),
      "Неверный код или срок его истёк",
    );
    assert.equal(
      mapAuthError({ code: "weak_password", message: "Password is known to be weak and easy to guess" }, "signup"),
      "Этот пароль слишком простой или уже утекал в интернет — придумайте другой",
    );
    assert.equal(
      mapAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }, "signin"),
      "Неверная почта или пароль",
    );
  });
});
