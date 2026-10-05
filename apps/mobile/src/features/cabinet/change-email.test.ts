import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { changeEmailRefusal } from "./change-email";

const here = dirname(fileURLToPath(import.meta.url));

// СМЕНА ПОЧТЫ (04.10): код на новую почту, отказы словами.
describe("смена почты аккаунта", () => {
  test("занятая почта и опечатка называются своими словами", () => {
    assert.equal(
      changeEmailRefusal({ code: "email_exists", message: "A user with this email address has already been registered" }),
      "Эта почта уже занята другим аккаунтом",
    );
    assert.equal(
      changeEmailRefusal({ code: "email_address_invalid", message: 'Email address "x" is invalid' }),
      "Проверьте адрес почты",
    );
  });

  test("код проверяется как смена почты, строка Email — дверь", () => {
    const sheet = readFileSync(resolve(here, "ChangeEmailSheet.tsx"), "utf8");
    assert.match(sheet, /type: "email_change",/);
    const page = readFileSync(resolve(here, "../../../app/(dashboard)/cabinet/account.tsx"), "utf8");
    assert.match(page, /onPress=\{u\?\.email \? \(\) => setEmailSheet\(true\) : undefined\}/);
  });
});
