import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// СТОРОЖ ВТОРОГО ШАГА ВХОДА. Замок в приложении держится на трёх местах:
// сессия первого шага не публикуется, гейт входа ведёт на экран кода, экран
// поднимает сессию кодом. Перепроверка паролем при смене пароля выдала бы
// сессию первого уровня — при двухфакторном входе её заменяет код.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

describe("двухфакторный вход — второй шаг", () => {
  test("сессия первого шага наружу не отдаётся", () => {
    const source = read("../../providers/SessionProvider.tsx");
    assert.match(source, /const pending = needsSecondStep\(next\);/);
    assert.match(source, /pending \? null : shouldPublishSession\(event, prev, next\)/);
    assert.match(source, /value=\{\{ session, loading, secondStepPending \}\}/);
  });

  test("гейт входа ведёт на экран кода до всех остальных переходов", () => {
    const source = read("../../../app/(auth)/_layout.tsx");
    const pending = source.indexOf("if (secondStepPending)");
    const signedIn = source.indexOf("if (session && !onResetPassword)");
    assert.ok(pending > 0 && pending < signedIn);
    assert.match(source, /if \(!onSecondStep\) return <Redirect href="\/mfa" \/>;/);
    assert.match(source, /<Stack\.Screen name="mfa" options=\{\{ gestureEnabled: false \}\} \/>/);
  });

  test("экран кода поднимает сессию кодом и даёт выйти", () => {
    const source = read("../../../app/(auth)/mfa.tsx");
    assert.match(source, /supabase\.auth\.mfa\.challengeAndVerify\(\{ factorId: factor\.id, code: token \}\)/);
    assert.match(source, /signOutAndWipe/);
  });

  test("смена пароля при двухфакторном входе — кодом, без входа паролем", () => {
    const source = read("../../features/cabinet/account/PasswordSection.tsx");
    assert.match(source, /supabase\.auth\.mfa\.challengeAndVerify\(\{\s*factorId: totpFactorId,/);
    assert.match(source, /byCode\s*\?\s*\{ error: null \}\s*:\s*await supabase\.auth\.signInWithPassword/);
  });

  test("аккаунту проверки Apple строки двухфакторного входа нет", () => {
    const source = read("../../features/cabinet/account/AccountScreen.tsx");
    assert.match(source, /twoFactorOffered\(u\?\.email\) \?/);
  });
});
