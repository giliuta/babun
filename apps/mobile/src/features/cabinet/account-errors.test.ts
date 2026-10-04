import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deleteRefusal, passwordRefusal } from "./account-errors";

describe("«Вход и безопасность» говорит словами", () => {
  test("ответы Supabase при смене пароля — фразами", () => {
    assert.equal(passwordRefusal("Password is known to be weak and easy to guess, please choose a different one."), "Пароль слишком простой или уже встречался в утечках — придумайте другой.");
    assert.equal(passwordRefusal("New password should be different from the old password."), "Новый пароль совпадает с текущим.");
    assert.equal(passwordRefusal("Request rate limit reached"), "Слишком много попыток — подождите минуту и повторите.");
    assert.equal(passwordRefusal("Password should be at least 6 characters."), "Пароль слишком короткий.");
    assert.equal(passwordRefusal("Email not confirmed"), "Почта аккаунта не подтверждена — подтвердите её по письму.");
    assert.equal(passwordRefusal("Some new English failure"), "Сервер не принял новый пароль. Попробуйте ещё раз.");
    // Обрыв — как есть: его узнаёт общий `writeErrorWords`.
    assert.equal(passwordRefusal("TypeError: Network request failed"), "TypeError: Network request failed");
  });

  test("отказ удаления аккаунта — по коду и статусу, не «non-2xx»", async () => {
    const reply = (status: number, body: unknown) => ({
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: { status, clone: () => ({ json: async () => body }) },
    });
    assert.equal((await deleteRefusal(reply(400, { error: "Confirmation does not match" }))).message, "Фраза подтверждения не совпала.");
    assert.match((await deleteRefusal(reply(401, { error: "Unauthorized" }))).message, /^Сессия устарела/);
    assert.match((await deleteRefusal(reply(503, { error: "Account deletion is unavailable" }))).message, /^Удаление сейчас недоступно/);
    assert.match((await deleteRefusal({ name: "FunctionsFetchError", message: "Failed to send" })).message, /^Нет связи с сервером/);
  });

  test("страница зовёт эти слова, а шапка — как строка Кабинета", () => {
    const page = readFileSync(path.join(__dirname, "../../../app/(dashboard)/cabinet/account.tsx"), "utf8");
    assert.match(page, /<ScreenHeader title="Вход и безопасность" \/>/);
    assert.match(page, /throw await deleteRefusal\(invokeError\)/);
    assert.match(page, /passwordRefusal\(error\.message\)/);
    assert.doesNotMatch(page, /notify\("Ошибка", e instanceof Error \? e\.message/);
  });
});
