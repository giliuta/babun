import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРАВА ПО ПРИГЛАШЕНИЮ — ОДНО ТЕЛО НА ОБА ВХОДА. У приглашения два входа:
// регистрация по ссылке (триггер `handle_new_user`) и приём уже вошедшим
// (`accept_invitation`). 14.09 выяснилось, что права на календарь выдавал
// только второй: триггер был старше прав по календарям, и позванный в один
// календарь диспетчер видел всю компанию. Сторож на накате миграции ловит это
// один раз; этот тест — каждый раз, когда функцию перепишут из старой копии.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");

type Definition = { file: string; body: string };

function definitionPattern(fn: string): RegExp {
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
}

/** Body from the LAST migration that defines the function — that one is live. */
function latestDefinition(fn: string): Definition | null {
  let latest: Definition | null = null;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(definitionPattern(fn))) {
      latest = { file, body: match[2] ?? "" };
    }
  }
  return latest;
}

describe("invitation calendar grants have one body", () => {
  const signup = latestDefinition("handle_new_user");
  const accept = latestDefinition("accept_invitation");
  const helper = latestDefinition("grant_invitation_calendar");

  test("signup through the invite link grants the invited calendar", () => {
    assert.ok(signup, "no migration defines public.handle_new_user");
    assert.match(
      signup.body,
      /perform\s+public\.grant_invitation_calendar\(v_invitation,\s*new\.id\)/,
      signup.file,
    );
  });

  test("accepting while signed in grants through the same helper", () => {
    assert.ok(accept, "no migration defines public.accept_invitation");
    assert.match(
      accept.body,
      /perform\s+public\.grant_invitation_calendar\(v_invitation,\s*auth\.uid\(\)\)/,
      accept.file,
    );
  });

  test("neither entry writes calendar rights on its own", () => {
    for (const entry of [signup, accept]) {
      assert.ok(entry, "an invitation entry has no migration");
      assert.doesNotMatch(
        entry.body,
        /insert\s+into\s+public\.calendar_members/i,
        entry.file,
      );
    }
  });

  test("the helper keeps the invitation defaults and skips archived calendars", () => {
    assert.ok(helper, "no migration defines public.grant_invitation_calendar");
    assert.match(
      helper.body,
      /when 'dispatcher' then array\['view','book','edit_all','clients','phones'\]/,
    );
    assert.match(helper.body, /else array\['view'\]/);
    assert.match(helper.body, /t\.is_active/);
    assert.match(
      helper.body,
      /on conflict \(tenant_id, team_id, user_id\) do nothing/,
    );
  });
});
