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
  test("подсказки календаря без тарифа не ведут в тупик", () => {
    const card = src("features/calendar/CalendarOnboardingCard.tsx");
    assert.match(card, /<TariffLocked key=\{s\.n\} locked=\{!!locked && !s\.done\}>/);
    assert.match(card, /label: workInPlan \? "Запланируйте запись" : "Запланируйте событие",/);
    assert.match(card, /disabled: workInPlan && \(!hasClients \|\| !hasServices\),/);
    assert.doesNotMatch(card, /\/cabinet\/services/);
    const home = app("(dashboard)/(home)/index.tsx");
    assert.equal(home.match(/\.\.\.\(workInPlan \? \{\} : \{ kind: "event" as const \}\),/g)?.length, 2);
    assert.match(home, /\/calendar\/services\?team=\$\{encodeURIComponent\(activeTeamId\)\}/);
    const empty = src("features/calendar/CalendarEmptyState.tsx");
    assert.match(empty, /\{event \? "Добавить первое событие" : "Добавить первую запись"\}/);
    assert.match(home, /<CalendarEmptyState\s+event=\{!workInPlan\}/);
  });

  test("первые экраны говорят «аккаунт» и «команды», не «компания»", () => {
    const invite = app("invite/[token].tsx");
    assert.doesNotMatch(invite, /Подключаем компанию|в этой компании|владельца компании/);
    assert.doesNotMatch(app("(auth)/onboarding.tsx"), /"Название компании"/);
    assert.doesNotMatch(app("(dashboard)/(home)/index.tsx"), /"В компании ещё нет календарей"/);
  });

  test("мастер: одна дверь в календарь, выход с первого шага, реквизиты переименованы", () => {
    const wizard = app("(auth)/onboarding.tsx");
    assert.doesNotMatch(wizard, /"Создать команду"/);
    assert.match(wizard, /label=\{saving \? "Сохраняем…" : "Открыть календарь"\}/);
    assert.match(wizard, /<PillButton label="Далее"[^\n]*\n[\s\S]{0,200}<GhostLink label="Выйти" muted onPress=\{\(\) => void signOutAndWipe\(\)\} \/>/);
    assert.match(wizard, /previousName: tenant\.name/);
    const tenant = src("lib/tenant.ts");
    assert.match(tenant, /\.from\("legal_entities"\)\s*\.update\(\{ name: name\.trim\(\) \}\)\s*\.eq\("tenant_id", tenantId\)\s*\.eq\("is_default", true\)\s*\.eq\("name", before\);/);
  });

  test("регистрация на занятый email не обещает письмо", () => {
    const register = app("(auth)/register.tsx");
    const hit = register.indexOf("if (signUpHitExistingAccount(data))");
    assert.ok(hit > 0);
    assert.ok(hit < register.indexOf("setPending(true);"));
  });
});
