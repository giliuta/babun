import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import { firstCalendarFromRpc } from "./first-calendar";

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
  test("экран календаря зовёт create_first_calendar, а не прямую вставку", () => {
    const screen = readFileSync(resolve(here, "../../../app/(dashboard)/(home)/index.tsx"), "utf8");
    assert.match(screen, /useCreateFirstCalendar\(\)/);
    assert.doesNotMatch(screen, /useCreateTeam\(\)/);
    // «Создавать нечего» — только перечитать список, без счетов и выбора.
    assert.match(screen, /if \(!team\) \{\s*void refetchTeams\(\);\s*return;\s*\}/);
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
