import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// КАРТОЧКА МАСТЕРА ДО «ПРИГЛАСИТЬ» (владелец 15.09): имя, почта, телефон,
// должность, цвет, несколько календарей и права по блокам заполняются в
// приглашении и применяются разом при приёме. Сторож миграции проверяет это
// один раз на накате; этот тест — каждый раз, когда функцию перепишут из старой
// копии: вернётся отказ неживым блокам, прежняя форма create_invitation или
// приём, который снова забывает уровни.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const MIGRATION = "20260915110000_invitation_carries_card_calendars_and_rights.sql";

type Definition = { file: string; body: string };

function definitionPattern(fn: string): RegExp {
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
}

/** Body from the LAST migration that defines the function — that one is live. */
function latestDefinition(fn: string): Definition {
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
  assert.ok(latest, `no migration defines public.${fn}`);
  return latest;
}

const migration = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");

const CREATE_SIGNATURE = "text, text, text, text, text, text, text[], text, text, jsonb";
const UPDATE_SIGNATURE = "uuid, text, text, text[], text, text, jsonb";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("the invitation carries the card, calendars and rights", () => {
  test("new invitation columns exist with their checks", () => {
    assert.match(migration, /add column if not exists team_ids text\[\]/);
    assert.match(migration, /add column if not exists master_title text/);
    assert.match(migration, /add column if not exists master_color text/);
    assert.match(
      migration,
      /add column if not exists access_changes jsonb not null default '\[\]'::jsonb/,
    );
    assert.match(migration, /char_length\(master_title\) between 1 and 120/);
    assert.match(migration, /master_color ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
    assert.match(migration, /coalesce\(team_ids\[1\] = team_id, false\)/);
    assert.match(migration, /jsonb_typeof\(access_changes\) = 'array'/);
  });

  // Приём по номеру существующей карточки должность и цвет не переносит:
  // сохранить их в таком приглашении значило бы молча потерять.
  test("job title and colour cannot be stored next to an existing card", () => {
    assert.match(
      migration,
      /add constraint invitations_card_fields_only_without_card\s+check \(master_id is null or \(master_title is null and master_color is null\)\)/,
    );
  });

  test("existing invitations get their one calendar as the list", () => {
    assert.match(
      migration,
      /update public\.invitations\s+set team_ids = array\[team_id\]\s+where team_id is not null/,
    );
  });
});

describe("rights helpers are internal and shared", () => {
  test("both helpers are security definer and closed to every client role", () => {
    for (const signature of [
      String.raw`access_validate_changes\(p_tenant uuid, p_team_ids text\[\], p_changes jsonb\)\s+returns void`,
      String.raw`access_apply_changes\(p_tenant uuid, p_user uuid, p_changes jsonb, p_set_by uuid\)\s+returns void`,
    ]) {
      assert.match(
        migration,
        new RegExp(String.raw`function public\.${signature}[\s\S]*?security definer\s+set search_path to 'public'`),
      );
    }
    assert.match(
      migration,
      /revoke all on function public\.access_validate_changes\(uuid, text\[\], jsonb\) from public, anon, authenticated;/,
    );
    assert.match(
      migration,
      /revoke all on function public\.access_apply_changes\(uuid, uuid, jsonb, uuid\) from public, anon, authenticated;/,
    );
    assert.doesNotMatch(migration, /grant execute on function public\.access_(validate|apply)_changes/);
  });

  // Решение владельца 15.09: уровни хранятся сейчас, применяются, когда блок
  // оживёт. Отказ `access:not_live` у писателя ломал бы карточку приглашения
  // на первом же переключателе — живых блоков пока нет.
  test("non-live blocks are accepted everywhere a level is written", () => {
    const validate = latestDefinition("access_validate_changes");
    const setter = latestDefinition("set_member_access");
    const trigger = latestDefinition("member_access_validate");
    for (const body of [validate, setter, trigger]) {
      assert.doesNotMatch(body.body, /not_live/, body.file);
      assert.doesNotMatch(body.body, /\bb\.live\b/, body.file);
    }
  });

  test("the validator keeps the access vocabulary and the calendar rules", () => {
    const { body, file } = latestDefinition("access_validate_changes");
    assert.match(body, /if b\.owner_only then/, file);
    assert.match(body, /hint = 'access:owner_only'/, file);
    assert.match(body, /hint = 'access:bad_block'/, file);
    assert.match(body, /hint = 'access:bad_level'/, file);
    assert.match(body, /hint = 'access:bad_changes'/, file);
    // Календарь — из этой компании; архив не проверяется, иначе владелец не
    // снимет уровень в заархивированном календаре прикреплённого сотрудника.
    assert.match(
      body,
      /if change_team is null or not exists \(\s*select 1 from public\.teams t\s+where t\.tenant_id = p_tenant\s+and t\.id = change_team\s*\)\s*then\s+raise exception [^;]*hint = 'access:bad_team'/,
      file,
    );
    assert.doesNotMatch(body.replace(/--.*$/gm, ""), /is_active/, file);
    assert.match(body, /change_team = any\(p_team_ids\)[\s\S]*?hint = 'access:not_attached'/, file);
    assert.match(body, /elsif change_team is not null then\s+raise exception [^;]*hint = 'access:bad_team'/, file);
    assert.match(body, /if change_key = any\(seen\) then/, file);
  });

  test("the writer needs no signed-in user and stores only non-defaults", () => {
    const { body, file } = latestDefinition("access_apply_changes");
    assert.doesNotMatch(body, /auth\.uid\(\)/, file);
    assert.match(body, /values \(p_tenant, p_user, b\.key, change_team, change_level, p_set_by, now\(\)\)/, file);
    assert.match(body, /on conflict \(tenant_id, user_id, block, team_id\)/, file);
    assert.match(body, /if change_level = b\.levels\[1\] then\s+delete from public\.member_access/, file);
  });

  test("set_member_access keeps its owner checks and writes through the shared helpers", () => {
    const { body, file } = latestDefinition("set_member_access");
    assert.match(body, /active_tenant uuid := public\.access_writer_target\(p_user_id\)/, file);
    assert.match(body, /perform public\.access_validate_changes\(active_tenant, attached, p_changes\)/, file);
    assert.match(
      body,
      /perform public\.access_apply_changes\(active_tenant, p_user_id, p_changes, auth\.uid\(\)\)/,
      file,
    );
    assert.doesNotMatch(body, /insert\s+into\s+public\.member_access/i, file);
    assert.match(body, /return public\.access_map_for\(active_tenant, p_user_id, true\)/, file);
  });

  // Уровни приглашения — jsonb без внешнего ключа: переименование блока должно
  // доехать до них так же, как каскад доносит его до member_access.
  test("a renamed block is carried into open invitations", () => {
    assert.match(
      migration,
      /create trigger access_blocks_rename_in_invitations\s+after update of key on public\.access_blocks\s+for each row\s+when \(old\.key is distinct from new\.key\)/,
    );
    const { body, file } = latestDefinition("access_blocks_rename_in_invitations");
    assert.match(body, /jsonb_set\(c\.change, '\{block\}', to_jsonb\(new\.key\)\)/, file);
    assert.match(body, /where i\.accepted_at is null/, file);
    assert.match(
      migration,
      /revoke all on function public\.access_blocks_rename_in_invitations\(\) from public, anon, authenticated;/,
    );
  });
});

describe("create_invitation takes the whole card", () => {
  test("the six-argument form is dropped and the new one is for signed-in users only", () => {
    assert.match(
      migration,
      /drop function if exists public\.create_invitation\(text, text, text, text, text, text\);/,
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.create_invitation\\(${escapeRegExp(CREATE_SIGNATURE)}\\) from public, anon;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.create_invitation\\(${escapeRegExp(CREATE_SIGNATURE)}\\) to authenticated;`),
    );
  });

  // Старые сборки зовут по именам (p_email, p_role, p_team_id, p_full_name,
  // p_phone): прежние параметры остаются первыми и с теми же умолчаниями.
  test("the signature keeps the old named parameters first", () => {
    assert.match(
      migration,
      /function public\.create_invitation\(\s*p_email text,\s*p_role text,\s*p_master_id text default null::text,\s*p_team_id text default null::text,\s*p_full_name text default null::text,\s*p_phone text default null::text,\s*p_team_ids text\[\] default null::text\[\],\s*p_master_title text default null::text,\s*p_master_color text default null::text,\s*p_access jsonb default null::jsonb\s*\)/,
    );
  });

  test("every existing check survives and the new fields are validated", () => {
    const { body, file } = latestDefinition("create_invitation");
    for (const kept of [
      /only an owner can create invitations/,
      /finish company setup before inviting employees/,
      /invitation role must be dispatcher or master/,
      /calendar not found or archived/,
      /master invitation requires a calendar or an employee card/,
      /dispatcher invitation cannot link an employee card/,
      /employee card already has a pending invitation/,
      /invalid invitation email/,
      /invitation name is too long/,
      /invalid invitation phone/,
      /this account already has access to the tenant/,
      /delete from public\.invitations\s+where tenant_id = v_tenant_id\s+and lower\(email\) = v_email\s+and accepted_at is null/,
      /v_token := translate\(/,
    ]) {
      assert.match(body, kept, file);
    }
    assert.match(body, /unnest\(array\[v_team_id\] \|\| coalesce\(p_team_ids, array\[\]::text\[\]\)\)/, file);
    assert.match(body, /v_team_id := v_team_ids\[1\];/, file);
    assert.match(body, /invitation job title is too long/, file);
    assert.match(body, /v_master_color !~ '\^#\[0-9A-Fa-f\]\{6\}\$'/, file);
    assert.match(body, /perform public\.access_validate_changes\(v_tenant_id, v_team_ids, v_access\)/, file);
    assert.match(body, /full_name, phone, team_ids, master_title, master_color, access_changes/, file);
  });

  // Текст отказа прежний: приложение подбирает фразу по нему
  // (invitation-flow.ts), а календарь называют hint и detail.
  test("a refused calendar keeps its message and is named by hint and detail", () => {
    const { body, file } = latestDefinition("create_invitation");
    assert.match(
      body,
      /raise exception 'calendar not found or archived'\s+using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;/,
      file,
    );
    assert.match(body, /hint = 'invite:needs_calendar'/, file);
  });

  test("job title and colour are refused for an invitation that links an existing card", () => {
    const { body, file } = latestDefinition("create_invitation");
    assert.match(
      body,
      /if p_role = 'master' and v_master_id is not null\s+and \(v_master_title is not null or v_master_color is not null\) then\s+raise exception [^;]*hint = 'invite:card_fields_on_card'/,
      file,
    );
    assert.ok(
      body.indexOf("invite:card_fields_on_card") < body.search(/insert into public\.invitations/),
      `${file}: the card fields are stored before they are refused`,
    );
  });
});

describe("update_invitation edits a pending invitation", () => {
  test("only the owner, only their tenant, only a pending invitation", () => {
    const { body, file } = latestDefinition("update_invitation");
    assert.match(body, /public\.current_user_role\(\) is distinct from 'owner'/, file);
    assert.match(body, /and i\.tenant_id = v_tenant_id\s+for update;/, file);
    assert.match(body, /if v_invitation\.accepted_at is not null then/, file);
    assert.match(body, /if v_invitation\.expires_at <= now\(\) then/, file);
    assert.match(body, /perform public\.access_validate_changes\(v_tenant_id, v_team_ids, v_access\)/, file);
    assert.match(body, /set team_id = v_team_ids\[1\],/, file);
    assert.doesNotMatch(body, /token\s*:?=/, file);
    assert.match(body, /'token', v_invitation\.token/, file);
  });

  test("the edit is open to signed-in users only", () => {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.update_invitation\\(${escapeRegExp(UPDATE_SIGNATURE)}\\) from public, anon;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.update_invitation\\(${escapeRegExp(UPDATE_SIGNATURE)}\\) to authenticated;`),
    );
  });

  // Приём молча пропускает ушедший календарь — правка ведёт себя так же, иначе
  // приглашение нельзя сохранить в том виде, в каком его вернул сервер.
  test("a calendar gone since the invitation is dropped quietly, a newly added archived one is refused", () => {
    const { body, file } = latestDefinition("update_invitation");
    assert.match(
      body,
      /v_stored := array_remove\(coalesce\(v_invitation\.team_ids, array\[v_invitation\.team_id\]\), null\);/,
      file,
    );
    assert.match(body, /into v_gone[\s\S]*?coalesce\(x\.team_id = any\(v_stored\), false\)[\s\S]*?and t\.is_active/, file);
    assert.match(body, /and not coalesce\(x\.team_id = any\(v_stored\), false\)/, file);
    assert.match(
      body,
      /raise exception 'calendar not found or archived'\s+using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;/,
      file,
    );

    const teamsCleaned = body.search(
      /into v_team_ids\s+from unnest\(v_team_ids\) with ordinality as x\(team_id, ord\)\s+where not \(x\.team_id = any\(v_gone\)\)/,
    );
    const accessCleaned = body.search(/into v_access[\s\S]*?nullif\(c\.change ->> 'team_id', ''\) = any\(v_gone\)/);
    const needsCalendar = body.search(
      /raise exception 'master invitation requires a calendar or an employee card'\s+using errcode = '22023', hint = 'invite:needs_calendar';/,
    );
    const validate = body.indexOf("perform public.access_validate_changes(");
    for (const [name, at] of Object.entries({ teamsCleaned, accessCleaned, needsCalendar, validate })) {
      assert.ok(at >= 0, `${file}: ${name} is missing`);
    }
    assert.ok(teamsCleaned < needsCalendar, `${file}: a gone calendar still counts as the master's calendar`);
    assert.ok(accessCleaned < validate, `${file}: levels of a gone calendar reach the validator`);
    // Не массив доходит до общей проверки и получает её `access:bad_changes`.
    assert.match(body, /if jsonb_typeof\(v_access\) = 'array' then/, file);
  });

  test("job title and colour are refused for an invitation that links an existing card", () => {
    const { body, file } = latestDefinition("update_invitation");
    assert.match(
      body,
      /if v_invitation\.master_id is not null\s+and \(v_master_title is not null or v_master_color is not null\) then\s+raise exception [^;]*hint = 'invite:card_fields_on_card'/,
      file,
    );
  });
});

describe("acceptance applies everything at once", () => {
  test("calendars first, then the card, then the rights rows, then levels", () => {
    const { body, file } = latestDefinition("grant_invitation_calendar");
    const calendars = body.search(/insert\s+into\s+public\.member_calendars/i);
    const card = body.indexOf("public.attach_invited_master_card(p_invitation, p_user_id)");
    const grants = body.search(/insert\s+into\s+public\.calendar_members/i);
    const levels = body.indexOf("perform public.access_apply_changes(");
    for (const [name, at] of Object.entries({ calendars, card, grants, levels })) {
      assert.ok(at >= 0, `${file}: ${name} step is missing`);
    }
    assert.ok(calendars < card, `${file}: the card is made before calendars are attached`);
    assert.ok(card < grants, `${file}: calendar rights are written before the card exists`);
    assert.ok(grants < levels, `${file}: levels are written before calendar rights`);
  });

  test("every calendar of the invitation that is still active, vanished ones skipped", () => {
    const { body, file } = latestDefinition("grant_invitation_calendar");
    assert.match(body, /unnest\(coalesce\(p_invitation\.team_ids, array\[p_invitation\.team_id\]\)\)/, file);
    assert.match(body, /and t\.is_active/, file);
    assert.match(body, /from unnest\(v_team_ids\) as x\(team_id\)\s+on conflict \(tenant_id, user_id, team_id\) do nothing/, file);
  });

  // Домашний календарь могли заархивировать: карточка получает первый живой.
  test("the card's home is the first live calendar, set before the card is made", () => {
    const { body, file } = latestDefinition("grant_invitation_calendar");
    const branch = body.indexOf("if cardinality(v_team_ids) > 0 then");
    const home = body.indexOf("p_invitation.team_id := v_team_ids[1];");
    const card = body.indexOf("public.attach_invited_master_card(p_invitation, p_user_id)");
    assert.ok(branch >= 0 && home > branch, `${file}: the home is not taken from live calendars`);
    assert.ok(home < card, `${file}: the card is made before its home is chosen`);
  });

  test("levels come from the invitation, only for attached calendars and live registry blocks", () => {
    const { body, file } = latestDefinition("grant_invitation_calendar");
    assert.match(body, /p_invitation\.access_changes/, file);
    assert.match(body, /join public\.access_blocks b\s+on b\.key = c\.change ->> 'block'\s+and not b\.owner_only/, file);
    assert.match(body, /nullif\(c\.change ->> 'team_id', ''\) = any\(v_team_ids\)/, file);
    assert.match(
      body,
      /perform public\.access_apply_changes\(\s*p_invitation\.tenant_id, p_user_id, v_changes, p_invitation\.invited_by_user_id\s*\)/,
      file,
    );
    assert.doesNotMatch(body, /access_validate_changes/, file);
  });

  test("the card takes the job title and colour from the invitation", () => {
    const { body, file } = latestDefinition("attach_invited_master_card");
    assert.match(body, /id, tenant_id, full_name, phone, title, color, team_id, account_status, user_id, created_by/, file);
    assert.match(body, /nullif\(btrim\(p_invitation\.master_title\), ''\),\s*p_invitation\.master_color,/, file);
    assert.match(body, /title = coalesce\(nullif\(btrim\(p_invitation\.master_title\), ''\), m\.title\)/, file);
    assert.match(body, /color = coalesce\(p_invitation\.master_color, m\.color\)/, file);
  });

  // Архив одного «домашнего» календаря ломал весь приём и на регистрации по
  // ссылке ронял саму регистрацию. Отказ — только когда живых не осталось.
  // Вызов помощника одной строкой сверяет invitation-grants-contract.test.ts.
  test("both entries refuse only when no calendar of the invitation is live", () => {
    for (const fn of ["accept_invitation", "handle_new_user"]) {
      const { body, file } = latestDefinition(fn);
      const liveCheck = body.search(/unnest\(coalesce\(v_invitation\.team_ids, array\[v_invitation\.team_id\]\)\)/);
      const refusal = body.indexOf("'invitation calendar is archived'");
      assert.ok(liveCheck >= 0, `${file}: ${fn} still looks only at the home calendar`);
      assert.ok(refusal > liveCheck, `${file}: ${fn} refuses before checking every calendar`);
      assert.doesNotMatch(body, /t\.id = v_invitation\.team_id\s+and t\.is_active/, file);
      // Текст и код прежние — приложение различает отказ по ним.
      assert.match(body, /raise exception 'invitation calendar is archived'\s+using errcode = '42501';/, file);
    }
  });

  test("a deleted calendar leaves open invitations instead of cascading them away", () => {
    assert.match(
      migration,
      /create trigger trg_invitations_forget_deleted_calendar\s+before delete on public\.teams\s+for each row/,
    );
    const { body, file } = latestDefinition("invitations_forget_deleted_calendar");
    assert.match(body, /if not exists \(select 1 from public\.tenants where id = old\.tenant_id\) then/, file);
    assert.match(
      body,
      /cardinality\(array_remove\(coalesce\(i\.team_ids, array\[i\.team_id\]\), old\.id\)\) = 0/,
      file,
    );
    assert.match(
      body,
      /set team_ids = array_remove\(i\.team_ids, old\.id\),\s+team_id = \(array_remove\(i\.team_ids, old\.id\)\)\[1\],/,
      file,
    );
    assert.match(body, /where c\.v ->> 'team_id' is distinct from old\.id/, file);
    assert.match(
      migration,
      /revoke all on function public\.invitations_forget_deleted_calendar\(\) from public, anon, authenticated;/,
    );
  });

  test("editing an invitation signals the inbox and the inviter", () => {
    const { body, file } = latestDefinition("invitations_changed_signal");
    assert.match(
      body,
      /\(new\.accepted_at, new\.team_id, new\.team_ids, new\.access_changes,\s*new\.master_title, new\.master_color, new\.full_name, new\.phone\)\s*is not distinct from/,
      file,
    );
    assert.doesNotMatch(body, /new\.accepted_at is not distinct from old\.accepted_at then/, file);
    assert.match(body, /'invitations_changed'/, file);
    assert.match(
      migration,
      /after insert or delete\s+or update of accepted_at, team_id, team_ids, access_changes,\s+master_title, master_color, full_name, phone\s+on public\.invitations/,
    );
  });
});

describe("the inbox and the guard", () => {
  test("my_invitations keeps its fields and adds all calendars", () => {
    const { body, file } = latestDefinition("my_invitations");
    for (const key of ["id", "tenant_id", "company", "inviter", "role", "calendar", "expires_at", "created_at"]) {
      assert.match(body, new RegExp(`'${key}', `), `${file}: ${key}`);
    }
    assert.match(body, /'calendars', coalesce\(\(/, file);
    assert.match(body, /unnest\(coalesce\(i\.team_ids, array\[i\.team_id\]\)\)/, file);
  });

  // Архив домашнего календаря не прячет приглашение с другими живыми.
  test("my_invitations hides an invitation only when none of its calendars is live", () => {
    const { body, file } = latestDefinition("my_invitations");
    assert.match(body, /left join lateral \(/, file);
    assert.match(body, /and \(i\.team_id is null or tm\.id is not null\)/, file);
    assert.doesNotMatch(body, /tm\.is_active\)/, file);
  });

  test("the migration ends with a guard over the old form and the helper grants", () => {
    const guard = migration.slice(migration.lastIndexOf("do $guard$"));
    assert.match(guard, /^do \$guard\$/);
    assert.match(guard, /to_regprocedure\('public\.create_invitation\(text, text, text, text, text, text\)'\) is not null/);
    assert.match(guard, /'public\.access_validate_changes\(uuid, text\[\], jsonb\)'/);
    assert.match(guard, /'public\.access_apply_changes\(uuid, uuid, jsonb, uuid\)'/);
    assert.match(guard, /'public\.invitations_forget_deleted_calendar\(\)'/);
    assert.match(guard, /'public\.access_blocks_rename_in_invitations\(\)'/);
    assert.match(guard, /has_function_privilege\('anon', v_internal, 'execute'\)/);
    assert.match(guard, /has_function_privilege\('authenticated', v_internal, 'execute'\)/);
    assert.match(guard, /position\('access:not_live' in v_setter\) > 0/);
    assert.match(guard, /position\('t\.is_active' in v_validator\) > 0/);
    assert.match(guard, /position\('coalesce\(v_invitation\.team_ids, array\[v_invitation\.team_id\]\)' in v_accept\) = 0/);
    assert.match(guard, /position\('perform public\.grant_invitation_calendar\(v_invitation, new\.id\);' in v_signup\) = 0/);
    assert.match(guard, /tgname = 'trg_invitations_forget_deleted_calendar'/);
    assert.match(guard, /tgname = 'access_blocks_rename_in_invitations'/);
    assert.match(guard, /pg_get_triggerdef\(t\.oid\) like '%team_ids%'/);
    assert.match(guard, /conname = 'invitations_card_fields_only_without_card'/);
    assert.match(guard, /\$guard\$;\s*$/);
  });
});
