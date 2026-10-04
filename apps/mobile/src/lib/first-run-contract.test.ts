import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// АУДИТ ПЕРВОГО ВХОДА 03.10: новый аккаунт без тарифа, мастер, регистрация.
const here = dirname(fileURLToPath(import.meta.url));
const app = (rel: string) => readFileSync(resolve(here, "../../app", rel), "utf8");
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");

describe("первый вход нового аккаунта", () => {
  // ВЛАДЕЛЕЦ 04.10: «этой плашки не должно быть… вот этого внизу тоже».
  test("пустой календарь — просто сетка, без плашек первого запуска", () => {
    assert.throws(() => src("features/calendar/CalendarOnboardingCard.tsx"));
    assert.throws(() => src("features/calendar/CalendarEmptyState.tsx"));
    const home = app("(dashboard)/(home)/index.tsx");
    assert.doesNotMatch(home, /CalendarOnboardingCard|CalendarEmptyState|onboardingDismissed/);
  });

  test("первые экраны говорят «аккаунт» и «команды», не «компания»", () => {
    const invite = app("invite/[token].tsx");
    assert.doesNotMatch(invite, /Подключаем компанию|в этой компании|владельца компании/);
    assert.doesNotMatch(app("(dashboard)/(home)/index.tsx"), /"В компании ещё нет календарей"/);
  });

  // ВЛАДЕЛЕЦ 04.10: «как называется ваш бизнес… чем вы занимаетесь… всё
  // готово, соберите команду — это неправильно». Мастера нет: имя аккаунта —
  // первое поле регистрации, после кода из письма сразу календарь.
  test("регистрация без мастера: имя с формы, код из письма, сразу календарь", () => {
    assert.throws(() => app("(auth)/onboarding.tsx"));
    const register = app("(auth)/register.tsx");
    assert.match(register, /placeholder="Имя или название компании"/);
    assert.match(register, /full_name: fullName\.trim\(\),/);
    assert.match(register, /<EmailCodeCard\s+kind="signup"/);
    assert.doesNotMatch(register, /"\/onboarding"/);
    const tenant = src("lib/tenant.ts");
    assert.doesNotMatch(tenant, /needs-onboarding|useCompleteOnboarding/);
    assert.doesNotMatch(src("lib/DashboardGate.tsx"), /\/onboarding/);
    assert.doesNotMatch(app("(auth)/_layout.tsx"), /\/onboarding/);
  });

  test("неподтверждённый вход и сброс пароля — тем же кодом", () => {
    const login = app("(auth)/login.tsx");
    assert.match(login, /email_not_confirmed/);
    assert.match(login, /<EmailCodeCard\s+kind="signup"/);
    const reset = app("(auth)/reset-password.tsx");
    assert.match(reset, /<EmailCodeCard\s+kind="recovery"/);
    assert.match(app("(auth)/forgot-password.tsx"), /pathname: "\/reset-password", params: \{ email: email\.trim\(\) \}/);
    const card = src("components/auth/EmailCodeCard.tsx");
    assert.match(card, /type: kind === "signup" \? "email" : "recovery",/);
  });

  test("регистрация на занятый email не обещает письмо", () => {
    const register = app("(auth)/register.tsx");
    const hit = register.indexOf("if (signUpHitExistingAccount(data))");
    assert.ok(hit > 0);
    assert.ok(hit < register.indexOf("setPending(true);"));
  });
});
