import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { CALENDAR_WORK_SOURCES, paidFromSummary } from "@/session/calendar-price";

// СВОДКА ПО КОМАНДАМ — ОДНИМ ВЫЗОВОМ, ТЕМ ЖЕ ПРАВИЛОМ.
//
// «Тариф» и «Новый календарь» считали платные календари запросами `limit(1)`
// по каждой команде и таблице. Теперь — `calendar_work_summary`: один вызов
// под RLS вызывающего. Правило «работа = запись work, операция или SMS» обязано
// остаться тем же, что у `paid_calendar_count` (её сверяет
// `paid-calendars-parity.test.ts`), иначе экран и Stripe назовут разные суммы.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const NAME = "20261028154000_calendar_work_summary.sql";
const file = [path.join(ROOT, "supabase/migrations", NAME), path.join(ROOT, "supabase/parked", NAME)].find((p) =>
  existsSync(p),
);
const SQL = file ? readFileSync(file, "utf8") : "";
const HOOK = readFileSync(path.join(ROOT, "apps/mobile/src/features/tariffs/use-live-calendars.ts"), "utf8");

describe("calendar_work_summary", () => {
  test("живые календари аккаунта и те же источники работы, что у приложения", () => {
    assert.ok(SQL, "нет миграции");
    assert.match(SQL, /from public\.teams t\s+where t\.tenant_id = p_tenant\s+and t\.is_active/);
    const tables = [...SQL.matchAll(/select 1 from public\.(\w+) \w+/g)].map((m) => m[1]);
    assert.deepEqual(tables, CALENDAR_WORK_SOURCES.map((s) => s.table));
    for (const source of CALENDAR_WORK_SOURCES) {
      const block = SQL.slice(SQL.indexOf(`from public.${source.table}`)).split(")")[0] ?? "";
      assert.match(block, /team_id = t\.id and \w+\.tenant_id = p_tenant/, source.table);
      if ("kind" in source) assert.match(block, new RegExp(`kind = '${source.kind}'`), source.table);
      else assert.doesNotMatch(block, /kind =/, source.table);
    }
  });

  test("права — как у прежних чтений: под RLS вызывающего, гостю нельзя", () => {
    assert.match(SQL, /security invoker/);
    assert.doesNotMatch(SQL, /security definer/);
    assert.match(SQL, /revoke all on function public\.calendar_work_summary\(uuid\) from public, anon;/);
    assert.match(SQL, /grant execute on function public\.calendar_work_summary\(uuid\) to authenticated;/);
  });

  test("приложение зовёт сводку, а прежний путь — только пока её нет", () => {
    assert.match(HOOK, /\.rpc\("calendar_work_summary", \{\s*p_tenant: tenantId,?\s*\}\)/);
    assert.match(HOOK, /const MISSING_FUNCTION = new Set\(\["PGRST202", "42883"\]\);/);
    // Любая другая ошибка — исключение, а не «работы нет».
    assert.match(HOOK, /if \(!summary\.error\.code \|\| !MISSING_FUNCTION\.has\(summary\.error\.code\)\) \{\s*throw/);
    assert.ok(HOOK.indexOf('rpc("calendar_work_summary"') < HOOK.indexOf('.from("teams")'));
  });

  test("число по сводке — живые календари с работой", () => {
    assert.equal(
      paidFromSummary([
        { team_id: "a", has_work: true },
        { team_id: "b", has_work: false },
        { team_id: "c", has_work: true },
      ]),
      2,
    );
    assert.equal(paidFromSummary([]), 0);
  });
});
