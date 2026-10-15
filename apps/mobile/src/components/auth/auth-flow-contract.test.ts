import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЭКРАНЫ ВХОДА ГОВОРЯТ ПРАВДУ И ПРОВЕРЯЮТ ОДНО И ТО ЖЕ. Экраны тянут
// react-native и под раннером не поднимаются — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const screen = (name: string) => readFileSync(resolve(here, `../../../app/(auth)/${name}`), "utf8");

test("вход в неподтверждённый аккаунт не врёт, что письмо ушло", () => {
  // «Войти» письма не шлёт; карточка по умолчанию считает письмо отправленным
  // и на минуту гасит «Отправить ещё раз».
  const login = screen("login.tsx");
  const card = login.slice(login.indexOf("<EmailCodeCard"), login.indexOf("/>", login.indexOf("<EmailCodeCard")));
  assert.match(card, /sentAlready=\{false\}/);
});

test("«Почти готово» держит тот же минимум пароля, что регистрация", () => {
  const finish = screen("finish-signup.tsx");
  assert.match(finish, /password\.length >= PASSWORD_MIN/);
  assert.match(finish, /passwordTooShort\(password\)/);
  assert.doesNotMatch(finish, /password\.length > 0\)/);
});
