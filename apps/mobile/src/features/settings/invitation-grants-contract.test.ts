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

  // ПРАВА ПО БЛОКАМ, ЭТАП 1 (14.09): приглашённый прикрепляется к календарю из
  // приглашения, иначе владелец не видит его в людях календаря и на экране прав.
  // Уровни приглашение не выдаёт — новый сотрудник «всё выключено».
  test("the helper attaches the invited person to the calendar without granting levels", () => {
    assert.ok(helper, "no migration defines public.grant_invitation_calendar");
    assert.match(helper.body, /insert\s+into\s+public\.member_calendars/i, helper.file);
    assert.doesNotMatch(helper.body, /insert\s+into\s+public\.member_access/i, helper.file);
  });

  // КАРТОЧКА МАСТЕРУ ПРИ ПРИЁМЕ (15.09): без неё приглашённого мастера не
  // назначить в запись, а статус и фото сервер пускает по карточке. Карточку
  // заводит тот же помощник — значит, оба входа получают её одинаково.
  test("the helper gives an invited master without a card his own card", () => {
    assert.ok(helper, "no migration defines public.grant_invitation_calendar");
    assert.match(
      helper.body,
      /if p_invitation\.role = 'master' and p_invitation\.master_id is null then\s+v_master_id := public\.attach_invited_master_card\(p_invitation, p_user_id\);/,
      helper.file,
    );
    assert.match(helper.body, /values \(\s*p_invitation\.tenant_id,\s*p_invitation\.team_id,\s*p_user_id,\s*v_master_id,/, helper.file);
  });

  test("the card belongs to the account: found again by user and linked to the membership", () => {
    const card = latestDefinition("attach_invited_master_card");
    assert.ok(card, "no migration defines public.attach_invited_master_card");
    assert.match(card.body, /and m\.user_id = p_user_id/, card.file);
    assert.match(card.body, /set team_id = p_invitation\.team_id/, card.file);
    assert.match(card.body, /update public\.tenant_members tm\s+set master_id = v_master_id/, card.file);
  });

  test("leaving the company sends the card to the archive", () => {
    const archive = latestDefinition("tenant_members_removed_archive_card");
    assert.ok(archive, "no migration defines public.tenant_members_removed_archive_card");
    assert.match(archive.body, /set is_active = false/, archive.file);
    assert.match(archive.body, /m\.user_id = old\.user_id or m\.id = old\.master_id/, archive.file);
  });
});

// МАСТЕР МЕНЯЕТ СТАТУС СВОЕЙ ЗАПИСИ (15.09). Любая правка записи мастером
// падала `record "new" has no field "is_demo"`: колонку сняли, а сторож
// `appointments_master_column_guard` продолжал её сравнивать. Владельца и
// диспетчера сторож пропускает первой строкой, поэтому поломку видит только
// мастер. Тест ловит возврат старой копии тела.
describe("the master column guard reads only live columns", () => {
  const guard = latestDefinition("appointments_master_column_guard");

  test("the latest guard body does not compare the dropped is_demo column", () => {
    assert.ok(guard, "no migration defines public.appointments_master_column_guard");
    assert.doesNotMatch(guard.body, /is_demo/, guard.file);
  });

  test("the guard still leaves a master only status and comment", () => {
    assert.ok(guard, "no migration defines public.appointments_master_column_guard");
    assert.match(guard.body, /master role can only update status and comment on work appointments/, guard.file);
    assert.doesNotMatch(guard.body, /new\.status is distinct from old\.status/, guard.file);
    assert.doesNotMatch(guard.body, /new\.comment is distinct from old\.comment/, guard.file);
  });
});
