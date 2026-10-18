import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import { firstCalendarFromRpc } from "./first-calendar";
import { calendarScreenSource } from "@/features/calendar/home/source-for-tests";

const here = import.meta.dirname;

describe("ответ «завести первый календарь»", () => {
  test("заведённый календарь — он и есть", () => {
    const team = firstCalendarFromRpc<{ id: string | null; name: string }>({ id: "team-1", name: "Личный" });
    assert.deepEqual(team, { id: "team-1", name: "Личный" });
  });

  test("«создавать нечего» объектом с пустыми полями — null", () => {
    assert.equal(firstCalendarFromRpc({ id: null, name: null, tenant_id: null }), null);
  });

  test("пустой ответ — null", () => {
    assert.equal(firstCalendarFromRpc(null), null);
    assert.equal(firstCalendarFromRpc(undefined), null);
  });
});

describe("первый календарь заводит база, а не список на устройстве", () => {
  test("экран календаря открывает шторку первого календаря, а не заводит его сам", () => {
    const screen = calendarScreenSource();
    assert.match(screen, /<CalendarCreateSheet\s+first\b/);
    assert.doesNotMatch(screen, /useCreateTeam\(\)/);
    assert.doesNotMatch(screen, /useCreateFirstCalendar\(\)/);
    // Календарь без имени не заводится: ни эффекта, ни вызова без шторки.
    assert.doesNotMatch(screen, /createFirstCalendar\(\)/);
    // «Создавать нечего» — только перечитать список.
    assert.match(screen, /const onFirstCalendarExisting = \(\) => \{\s*void refetchTeams\(\);\s*tourEvent\("calendar-created"\);\s*\}/);
  });

  test("шторка первого календаря зовёт create_first_calendar", () => {
    const sheet = readFileSync(resolve(here, "../calendar/CalendarCreateSheet.tsx"), "utf8");
    assert.match(sheet, /const made = await createFirst\.mutateAsync\(input\);/);
    assert.match(sheet, /if \(!made\) \{\s*onExisting\?\.\(\);/);
  });

  test("регистрация больше не заводит календарь сама", () => {
    const sql = readFileSync(
      resolve(here, "../../../../../supabase/migrations/20261018100000_signup_without_calendar.sql"),
      "utf8",
    );
    assert.match(sql, /pg_get_functiondef\('public\.ensure_personal_space\(uuid\)'::regprocedure\)/);
    assert.match(sql, /insert into public\.teams \(id, tenant_id, name, payout_percentage\)/);
    // Вместо календаря регистрация заводит обучение с нуля.
    assert.match(sql, /v_def := replace\(v_def, v_old, \$q\$  insert into public\.onboarding_progress \(user_id, tenant_id\)/);
    assert.match(sql, /якорь вставки календаря не найден/);
  });

  test("функция базы проверяет живые календари под замком компании", () => {
    const sql = readFileSync(
      resolve(here, "../../../../../supabase/migrations/20261004015317_create_first_calendar_once.sql"),
      "utf8",
    );
    assert.match(sql, /security invoker/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('first_calendar:'/);
    assert.match(sql, /where t\.tenant_id = v_tenant and t\.is_active/);
    assert.match(sql, /revoke all on function public\.create_first_calendar\(text, text, text\) from public, anon;/);
  });
});
