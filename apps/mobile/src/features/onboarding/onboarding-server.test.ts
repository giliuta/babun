import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Обучение не ходит на сервер, пока его функций там нет: каждый запуск
// владельца иначе давал три 404 на `my_onboarding`.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "use-onboarding.ts"), "utf8");
const migrations = resolve(here, "../../../../../supabase/migrations");

test("чтение прогресса закрыто флагом и не повторяется", () => {
  assert.match(source, /enabled: ONBOARDING_SERVER_READY && /);
  assert.match(source, /retry: false,/);
});

test("отметка главы без сервера не уходит", () => {
  const mark = source.slice(source.indexOf("export function useMarkOnboardingDone"));
  const guard = mark.indexOf("if (!ONBOARDING_SERVER_READY) return null;");
  assert.ok(guard > 0, "нет заслонки в mutationFn");
  assert.ok(guard < mark.indexOf('rpc("onboarding_done"'), "заслонка после вызова");
});

test("флаг называет миграцию, которая приносит функции", () => {
  const name = "20261018100000_signup_without_calendar";
  assert.match(source, new RegExp(name));
  const sql = readFileSync(resolve(migrations, `${name}.sql`), "utf8");
  assert.match(sql, /create or replace function public\.my_onboarding\(\)/);
  assert.match(sql, /create or replace function public\.onboarding_done\(p_chapter text\)/);
});
