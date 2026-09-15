import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// «ЗАКРЫТИЕ ДНЯ» УДАЛЕНО С СЕРВЕРА (владелец: «удали это вообще, чтоб я этого
// больше не слышал»). Сторож миграции проверяет каталог один раз на накате; этот
// тест — каждый раз, когда миграцию перепишут: шаги встанут в порядок, при
// котором внешний ключ или словарь не отпустят строку; вернётся CASCADE и молча
// унесёт неожиданную зависимость; вместе со сторожем закрытого дня пропадёт
// запрет операций будущим числом; миграция перепишет чужие функции; или более
// поздняя миграция вернёт удалённое.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const MIGRATION = "20260915170000_close_day_removed.sql";

const migration = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");

/** SQL without `--` comments: an explanation must neither satisfy nor break a check. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, "");
}

/** Comment-free SQL on one line, for word-for-word comparisons. */
function squash(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim();
}

const sqlOnly = stripComments(migration);

type Definition = { file: string; body: string };

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function definitionPattern(fn: string): RegExp {
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
}

/** Body from the last migration that defines the function; with `until`, only files before it. */
function latestDefinition(fn: string, until?: string): Definition {
  let latest: Definition | null = null;
  for (const file of migrationFiles()) {
    if (until !== undefined && file >= until) {
      break;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(definitionPattern(fn))) {
      latest = { file, body: match[2] ?? "" };
    }
  }
  assert.ok(latest, `no migration defines public.${fn}`);
  return latest;
}

/** Body of the function as this migration defines it. */
function ownDefinition(fn: string): string {
  const matches = [...migration.matchAll(definitionPattern(fn))];
  assert.equal(matches.length, 1, `${MIGRATION} must define public.${fn} exactly once`);
  return matches[0]?.[2] ?? "";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where a statement starts in the comment-free SQL; fails when it is missing. */
function statementAt(pattern: RegExp, label: string): number {
  const index = sqlOnly.search(pattern);
  assert.ok(index >= 0, `${MIGRATION}: ${label} is missing`);
  return index;
}

describe("the removal runs in the owner's order", () => {
  // Уровни уходят раньше блока (внешний ключ без каскада), право — раньше
  // словаря, который его запрещает; новый сторож встаёт до сноса старого;
  // функции, возвращавшие строку таблицы, — до таблицы; сторож — последним.
  test("data first, then the new guard, then the old objects, then the guard block", () => {
    const steps: ReadonlyArray<readonly [string, number]> = [
      [
        "levels of the block",
        statementAt(/delete from public\.member_access ma\s+where ma\.block = 'finance\.close_day';/, "levels delete"),
      ],
      [
        "levels pending in open invitations",
        statementAt(/update public\.invitations i\s+set access_changes = /, "invitations update"),
      ],
      [
        "calendar right",
        statementAt(
          /update public\.calendar_members cm\s+set grants = array_remove\(cm\.grants, 'close_day'\)\s+where 'close_day' = any\(cm\.grants\);/,
          "calendar right removal",
        ),
      ],
      [
        "old dictionary",
        statementAt(/alter table public\.calendar_members\s+drop constraint calendar_members_grants_known;/, "dictionary drop"),
      ],
      [
        "new dictionary",
        statementAt(/alter table public\.calendar_members\s+add constraint calendar_members_grants_known check \(/, "dictionary add"),
      ],
      ["my calendars", statementAt(/create or replace function public\.list_my_calendars\(\)/, "list_my_calendars")],
      [
        "registry row",
        statementAt(/delete from public\.access_blocks b\s+where b\.key = 'finance\.close_day';/, "registry delete"),
      ],
      [
        "future-date guard",
        statementAt(/create or replace function public\.guard_future_dated_finance_write\(\)/, "future-date guard"),
      ],
      ["future-date trigger", statementAt(/create trigger finance_transactions_future_date_guard\b/, "future-date trigger")],
      [
        "ledger trigger",
        statementAt(/drop trigger finance_transactions_closed_day_guard on public\.finance_transactions;/, "ledger trigger drop"),
      ],
      ["account trigger", statementAt(/drop trigger accounts_closed_day_guard on public\.accounts;/, "account trigger drop")],
      ["ledger guard", statementAt(/drop function public\.guard_closed_day_finance_write\(\);/, "ledger guard drop")],
      ["account guard", statementAt(/drop function public\.guard_closed_day_account_write\(\);/, "account guard drop")],
      ["close wrapper", statementAt(/drop function public\.close_business_day\(date, bigint\);/, "close wrapper drop")],
      ["close", statementAt(/drop function public\.close_business_day\(date\);/, "close drop")],
      ["reopen", statementAt(/drop function public\.reopen_business_day\(date\);/, "reopen drop")],
      ["read", statementAt(/drop function public\.read_day_closure\(date\);/, "read drop")],
      ["expected cash", statementAt(/drop function public\.tenant_cash_ledger_cents\(uuid, date\);/, "expected cash drop")],
      ["table", statementAt(/drop table public\.day_closures;/, "table drop")],
      ["guard block", statementAt(/do \$guard\$/, "guard block")],
    ];
    steps.forEach(([name, index], position) => {
      if (position === 0) {
        return;
      }
      const [previousName, previousIndex] = steps[position - 1] ?? ["", -1];
      assert.ok(previousIndex < index, `${MIGRATION}: «${name}» runs before «${previousName}»`);
    });
  });

  // Снесённое сносится без `if exists` и без CASCADE: объект, которого нет, или
  // неожиданная зависимость должны уронить миграцию на своём операторе.
  test("every removed object is dropped once, explicitly, without CASCADE", () => {
    assert.doesNotMatch(sqlOnly, /\bcascade\b/i);
    const drops = [
      ...sqlOnly.matchAll(/\bdrop\s+(?:function|table|trigger|constraint|policy|index|view|type|column)\b[^;]*;/gi),
    ].map((match) => String(match[0]).replace(/\s+/g, " "));
    assert.deepEqual(drops, [
      "drop constraint calendar_members_grants_known;",
      "drop trigger if exists finance_transactions_future_date_guard on public.finance_transactions;",
      "drop trigger finance_transactions_closed_day_guard on public.finance_transactions;",
      "drop trigger accounts_closed_day_guard on public.accounts;",
      "drop function public.guard_closed_day_finance_write();",
      "drop function public.guard_closed_day_account_write();",
      "drop function public.close_business_day(date, bigint);",
      "drop function public.close_business_day(date);",
      "drop function public.reopen_business_day(date);",
      "drop function public.read_day_closure(date);",
      "drop function public.tenant_cash_ledger_cents(uuid, date);",
      "drop table public.day_closures;",
    ]);
  });

  // Сухой прогон вкладывает файл целиком в begin … rollback: свой commit внутри
  // закрепил бы прогон на боевой базе.
  test("the file carries no transaction control of its own", () => {
    assert.doesNotMatch(sqlOnly, /^\s*(?:begin|commit|rollback|start\s+transaction)\s*;/im);
  });

  test("the migration defines only my calendars and the future-date guard", () => {
    const defined = [...sqlOnly.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)]
      .map((match) => match[1] ?? "")
      .sort();
    assert.deepEqual(defined, ["guard_future_dated_finance_write", "list_my_calendars"]);
  });
});

describe("the future-date rule outlives the closed-day guard", () => {
  test("a before insert or update trigger runs a closed security definer function", () => {
    assert.match(
      migration,
      /create or replace function public\.guard_future_dated_finance_write\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path to 'public'/,
    );
    assert.match(
      migration,
      /revoke all on function public\.guard_future_dated_finance_write\(\) from public, anon, authenticated;/,
    );
    assert.doesNotMatch(sqlOnly, /grant [^;]*guard_future_dated_finance_write/);
    assert.match(
      sqlOnly,
      /create trigger finance_transactions_future_date_guard\s+before insert or update on public\.finance_transactions\s+for each row execute function public\.guard_future_dated_finance_write\(\);/,
    );
  });

  // Живое тело сторожа сверено при написании миграции: utf8-правки без файла
  // (`day_closure_texts_utf8_fix`, `day_closure_error_texts_utf8_fix`) текст этой
  // проверки не меняли, поэтому образец — последнее определение в файлах.
  test("the check is the removed guard's check, word for word", () => {
    const removed = latestDefinition("guard_closed_day_finance_write", MIGRATION);
    const start = removed.body.indexOf("business_today := public.tenant_business_date(tenant_uuid);");
    const end = removed.body.indexOf("end if;", start);
    assert.ok(start >= 0 && end > start, `${removed.file}: the future-date check is not where it was`);
    const check = squash(removed.body.slice(start, end + "end if;".length));
    assert.equal(
      check,
      "business_today := public.tenant_business_date(tenant_uuid); if new_date is not null and new_date > business_today then raise exception 'Финансовую операцию нельзя датировать будущим числом'; end if;",
      removed.file,
    );
    const body = ownDefinition("guard_future_dated_finance_write");
    assert.ok(squash(body).includes(check), "the new guard does not repeat the removed check");
    assert.match(body, /tenant_uuid := new\.tenant_id;/);
    assert.match(body, /new_date := new\.occurred_on;/);
  });

  // Код отказа остаётся P0001 — `raise` без `errcode`, как у прежнего сторожа.
  test("without the closed-day check, the lock or a new error code", () => {
    const body = stripComments(ownDefinition("guard_future_dated_finance_write"));
    assert.doesNotMatch(body, /pg_advisory_xact_lock|day_closures|protected_date|is_closed/);
    assert.doesNotMatch(body, /\berrcode\b/i);
    assert.match(
      body,
      /if not exists \(select 1 from public\.tenants t where t\.id = tenant_uuid\) then\s+return new;\s+end if;/,
    );
    assert.ok(
      body.indexOf("from public.tenants t") < body.indexOf("public.tenant_business_date("),
      "the company date is read before the cascade skip",
    );
  });

  // Postgres зовёт триггеры одного момента по алфавиту имён. Имена — снимок живой
  // таблицы на момент миграции: новое имя стоит там же, где стояло прежнее.
  test("the trigger keeps the removed guard's place in the firing order", () => {
    const removedName = "finance_transactions_closed_day_guard";
    const name = "finance_transactions_future_date_guard";
    for (const other of [
      "finance_tx_set_updated_at",
      "trg_assert_finance_transaction_integrity",
      "trg_fill_transaction_vat",
      "trg_guard_cash_count_transaction_write",
      "trg_protect_invoice_payment_row",
      "trg_validate_invoice_payment_insert",
    ]) {
      assert.ok(removedName < other, `${removedName} did not fire before ${other}`);
      assert.ok(name < other, `${name} fires after ${other}`);
    }
  });
});

describe("the right and the block leave everywhere", () => {
  test("the calendar dictionary is the original one without close_day", () => {
    const original = readFileSync(join(MIGRATIONS_DIR, "20260912150000_calendar_members.sql"), "utf8");
    const grantsIn = (sql: string, from: RegExp): string[] => {
      const clean = stripComments(sql);
      const start = clean.search(from);
      assert.ok(start >= 0, `dictionary not found: ${from}`);
      const block = clean.slice(start, clean.indexOf("]::text[]", start));
      return [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? "");
    };
    const before = grantsIn(original, /constraint calendar_members_grants_known check \(/);
    const after = grantsIn(migration, /add constraint calendar_members_grants_known check \(/);
    assert.ok(before.includes("close_day"), "the original dictionary no longer lists close_day");
    assert.deepEqual(after, before.filter((grant) => grant !== "close_day"));
  });

  test("open invitations drop the block's pending levels, accepted ones stay history", () => {
    assert.match(
      sqlOnly,
      /update public\.invitations i\s+set access_changes = coalesce\(\(\s+select jsonb_agg\(c\.change order by c\.ord\)\s+from jsonb_array_elements\(i\.access_changes\) with ordinality as c\(change, ord\)\s+where c\.change ->> 'block' is distinct from 'finance\.close_day'\s+\), '\[\]'::jsonb\)\s+where i\.accepted_at is null\s+and jsonb_typeof\(i\.access_changes\) = 'array'\s+and i\.access_changes @> '\[\{"block": "finance\.close_day"\}\]'::jsonb;/,
    );
  });

  // Живое тело совпадало с последним файлом, когда миграция писалась: сравнение
  // с файлом доказывает, что ушёл только `close_day`.
  test("my calendars lose close_day and nothing else", () => {
    const body = ownDefinition("list_my_calendars");
    assert.doesNotMatch(body, /close_day/);
    assert.match(
      body,
      /when tm\.role = 'owner' then array\[\s+'view','book','edit_all','clients','phones','finance','settings'\s+\]::text\[\]/,
    );
    const previous = latestDefinition("list_my_calendars", MIGRATION);
    assert.match(previous.body, /'finance','close_day','settings'/, previous.file);
    assert.equal(
      squash(body),
      squash(previous.body).replace("'finance','close_day','settings'", "'finance','settings'"),
      `list_my_calendars differs from ${previous.file} by more than close_day`,
    );
    assert.equal(latestDefinition("list_my_calendars").file, MIGRATION);
    assert.match(migration, /revoke all on function public\.list_my_calendars\(\) from public, anon;/);
    assert.match(migration, /grant execute on function public\.list_my_calendars\(\) to authenticated;/);
  });
});

// Удалённое не возвращается: поздняя миграция, переписавшая «мои календари»,
// словарь прав или реестр блоков по старому образцу, вернула бы раздел молча.
const REMOVED_NAMES = [
  "close_day",
  "day_closures",
  "close_business_day",
  "reopen_business_day",
  "read_day_closure",
  "tenant_cash_ledger_cents",
  "guard_closed_day_finance_write",
  "guard_closed_day_account_write",
] as const;

describe("later migrations do not bring the section back", () => {
  test("no later migration names a removed object outside comments", () => {
    for (const file of migrationFiles().filter((name) => name > MIGRATION)) {
      const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      for (const name of REMOVED_NAMES) {
        assert.doesNotMatch(sql, new RegExp(String.raw`(?<!\w)${escapeRegExp(name)}(?!\w)`), `${file}: ${name}`);
      }
    }
  });
});

describe("the migration ends with its guard", () => {
  test("the guard checks what left, what stays and what must not come back", () => {
    const guard = migration.slice(migration.lastIndexOf("do $guard$"));
    assert.match(guard, /^do \$guard\$/);
    assert.match(guard, /\$guard\$;\s*$/);
    assert.match(guard, /if to_regclass\('public\.day_closures'\) is not null then/);
    for (const signature of [
      "public.close_business_day(date)",
      "public.close_business_day(date, bigint)",
      "public.reopen_business_day(date)",
      "public.read_day_closure(date)",
      "public.tenant_cash_ledger_cents(uuid, date)",
      "public.guard_closed_day_finance_write()",
      "public.guard_closed_day_account_write()",
    ]) {
      assert.ok(guard.includes(`'${signature}'`), `the guard does not look for ${signature}`);
    }
    assert.match(guard, /if to_regprocedure\(v_removed\) is not null then/);
    assert.match(guard, /t\.tgname in \('finance_transactions_closed_day_guard', 'accounts_closed_day_guard'\)/);
    assert.match(guard, /t\.tgname = 'finance_transactions_future_date_guard'/);
    assert.match(guard, /t\.tgenabled in \('O', 'A'\)/);
    assert.match(guard, /cardinality\(t\.tgattr::int2\[\]\) = 0/);
    assert.match(
      guard,
      /strpos\(v_future, 'raise exception ''Финансовую операцию нельзя датировать будущим числом'';'\) = 0/,
    );
    assert.match(guard, /strpos\(v_future, 'pg_advisory_xact_lock'\) > 0/);
    assert.match(guard, /has_function_privilege\('authenticated', v_future_oid, 'execute'\)/);
    assert.match(guard, /'close_day' = any\(cm\.grants\)/);
    assert.match(guard, /strpos\(b\.key, 'close_day'\) > 0/);
    assert.match(guard, /strpos\(ma\.block, 'close_day'\) > 0/);
    assert.match(guard, /strpos\(i\.access_changes::text, 'close_day'\) > 0/);
    assert.match(guard, /strpos\(v_calendars, 'close_day'\) > 0/);
    assert.match(guard, /c\.conname = 'calendar_members_grants_known'/);
    assert.match(guard, /strpos\(v_check, 'close_day'\) > 0/);
    assert.match(guard, /strpos\(p\.prosrc, 'day_closures'\) > 0/);
    // В LIKE знак `_` — любой символ: проверки сторожа только через strpos.
    assert.doesNotMatch(guard, /\b(?:i?like)\b/i);
  });
});
