import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ВЫШЕДШИЙ НЕ ЗАСТРЕВАЕТ НА ЗАПАСНОМ ЭКРАНЕ (04.10, iPhone 17 Pro Max
// владельца: «почему она застыла и не открывается… сервер не отвечает»).
// Сервер отвечал. Телефон без входа стоял на /account-missing: экран для
// вошедшего, чьи данные не открылись, а без сессии он показывал знак и
// загрузку — без поля, без кнопки, навсегда. Гейт группы уводил с него
// только вошедших; а первым объявленным экраном группы был он же, так что
// любой переход в группу без адреса приводил туда же.
const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(here, "../../app/(auth)/_layout.tsx"), "utf8");

describe("вход без тупика", () => {
  test("без сессии запасной экран аккаунта уводит на вход", () => {
    assert.match(
      layout,
      /if \(!session && onAccountMissing\) return <Redirect href="\/login" \/>;/,
    );
    // Раньше гейта вошедших: тот открывается только с сессией.
    assert.ok(
      layout.indexOf("if (!session && onAccountMissing)") <
        layout.indexOf("if (session && !onResetPassword)"),
    );
  });

  test("первый экран группы входа — вход, а не запасной", () => {
    const login = layout.indexOf('<Stack.Screen name="login" />');
    const missing = layout.indexOf('<Stack.Screen name="account-missing"');
    assert.ok(login > 0, "вход не объявлен первым экраном группы");
    assert.ok(login < missing, "запасной экран объявлен раньше входа");
  });
});
