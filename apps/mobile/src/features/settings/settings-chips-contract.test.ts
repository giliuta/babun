import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ШЕСТЕРЁНКИ КАЛЕНДАРЯ И ФИНАНСОВ — ВСЕ КАЛЕНДАРИ ВСЕХ АККАУНТОВ ОДНОЙ ЛЕНТОЙ
// (владелец 09.10: «переключаться между командой один, командой два и своей
// личной… сразу все видно три команды, только разный доступ»).

const here = dirname(fileURLToPath(import.meta.url));
const app = (relative: string) => readFileSync(resolve(here, "../../../app", relative), "utf8");

test("настройки календаря не отбирают календари других аккаунтов", () => {
  const src = app("(dashboard)/(home)/calendar/index.tsx");
  assert.match(src, /items=\{gearChips\.items\}/);
  assert.doesNotMatch(src, /gearChipItems|hiddenElsewhere/);
});

test("настройки финансов — та же лента, что над финансами", () => {
  const src = app("(dashboard)/finances/settings.tsx");
  assert.match(src, /const chips = useCalendarChips\(\{\s*own: teams,/);
  assert.match(src, /items=\{chips\.items\}/);
  assert.match(src, /onSelect=\{chips\.pick\}/);
});

// ПАРТНЁР ВЫХОДИТ ИЗ КОМАНДЫ САМ (владелец 09.10: «добавить добавили, а выйти
// я уже не могу, если меня не удалят»).
test("в настройках чужой команды — «Выйти из команды», а не удаление", () => {
  const src = app("(dashboard)/(home)/calendar/index.tsx");
  assert.match(src, /const canLeave = role != null && role !== "owner";/);
  assert.match(src, /\{team && tenantId && canLeave \? \(/);
  assert.match(src, /leaveCalendar\.mutate\(\s*\{ tenantId, teamId: team\.id \}/);
  assert.match(src, /\{rows\.any \|\| canLeave \? \(/);
  const hook = readFileSync(resolve(here, "leave-calendar.ts"), "utf8");
  assert.match(hook, /supabase\.rpc\("leave_calendar"/);
  assert.match(hook, /if \(leftAccount\) await evictCompanyFromDevice\(input\.tenantId, \{ fresh: true \}\);/);
  const migration = readFileSync(
    resolve(here, "../../../../../supabase/migrations/20261009055418_leave_calendar.sql"),
    "utf8",
  );
  assert.match(migration, /if my_role = 'owner' then/);
  assert.match(migration, /revoke all on function public\.leave_calendar\(uuid, text\) from public, anon;/);
});
