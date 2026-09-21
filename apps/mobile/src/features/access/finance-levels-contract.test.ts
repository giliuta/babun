import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ДЕНЬГИ СЛУШАЮТСЯ УРОВНЕЙ (этап 2 доступа, срез 1; владелец 15.09: «чтоб всё
// сразу менялось в живом времени… максимальное качество»). Сторож миграции
// проверяет каталог один раз на накате; этот тест — каждый раз, когда кто-то
// перепишет правило, политику или функцию в обход. Сравнение идёт по ТЕКСТУ
// условий целиком (пробелы схлопнуты): прошлый сторож искал метки через
// includes, и шестнадцать из восемнадцати мутантов — снятый фильтр вошедшего,
// «or true», «write» вместо «read» — проходили его молча.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const MIGRATION = "20260915180000_finance_access_levels_live.sql";

const migration = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");

/** SQL without `--` comments: an explanation must neither satisfy nor break a check. */
const sqlOnly = migration.replace(/--[^\n]*$/gm, "");

/** One space between tokens, none just inside parentheses, no comments. */
function norm(sql: string): string {
  return sql
    .replace(/--[^\n]*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function definitionPattern(fn: string): RegExp {
  return new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
}

type Definition = { file: string; body: string };

/** Bodies of every migration that defines the function, oldest first. */
function definitions(fn: string): Definition[] {
  const found: Definition[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(definitionPattern(fn))) {
      found.push({ file, body: match[2] ?? "" });
    }
  }
  return found;
}

/** Body from the LAST migration that defines the function — that one is live. */
function latestDefinition(fn: string): Definition {
  const all = definitions(fn);
  const latest = all[all.length - 1];
  assert.ok(latest, `no migration defines public.${fn}`);
  return latest;
}

/** The definition right before this migration — what the owner runs today. */
function previousDefinition(fn: string): Definition {
  const earlier = definitions(fn).filter((d) => d.file < MIGRATION);
  const previous = earlier[earlier.length - 1];
  assert.ok(previous, `no earlier migration defines public.${fn}`);
  return previous;
}

/** Normalised body of the function as this migration defines it (exactly once). */
function own(fn: string): string {
  const match = [...migration.matchAll(definitionPattern(fn))];
  assert.equal(match.length, 1, `${MIGRATION} must define public.${fn} exactly once`);
  return norm(match[0]?.[2] ?? "");
}

/** The clause occurs in the normalised body exactly `times` times. */
function hasClause(body: string, clause: string, label: string, times = 1): void {
  assert.equal(count(body, norm(clause)), times, `${label}: ${norm(clause)}`);
}

function before(body: string, first: string, second: string, label: string): void {
  const a = body.indexOf(norm(first));
  const b = body.indexOf(norm(second));
  assert.ok(a >= 0 && b >= 0 && a < b, `${label}: «${first}» must come before «${second}»`);
}

describe("block rules are one set of safe helpers", () => {
  test("each rule is stable security definer with its own search_path", () => {
    for (const head of [
      String.raw`access_records_level\(p_tenant uuid, p_user uuid, p_team text\)\s+returns text\s+language sql`,
      String.raw`access_calendars_of\(p_tenant uuid, p_user uuid, p_block text, p_min text\)\s+returns text\[\]\s+language plpgsql`,
      String.raw`access_calendars\(p_block text, p_min text\)\s+returns text\[\]\s+language plpgsql`,
      String.raw`access_company\(p_block text, p_min text\)\s+returns boolean\s+language plpgsql`,
      String.raw`access_accounts_for\(p_block text, p_min text\)\s+returns uuid\[\]\s+language plpgsql`,
      String.raw`access_accounts_totals\(\)\s+returns uuid\[\]\s+language plpgsql`,
    ]) {
      assert.match(
        migration,
        new RegExp(String.raw`create or replace function public\.${head}\s+stable\s+security definer\s+set search_path to 'public'\s+as \$function\$`),
        head,
      );
    }
  });

  // Политики зовут три правила от имени вошедшего; аноним — никогда. Тела с
  // чужим человеком в аргументах и остатки клиенту не отдаются вовсе.
  test("grants: three rules for signed-in users, three internal bodies for nobody", () => {
    const grants = [...sqlOnly.matchAll(/^(revoke|grant) [^;]*? on function public\.(access_\w+)\(([^)]*)\) (?:from|to) ([^;]+);$/gm)]
      .map((m) => `${m[1]} ${m[2]}(${m[3]}) ${m[4]}`)
      .sort();
    assert.deepEqual(grants, [
      "grant access_accounts_for(text, text) authenticated",
      "grant access_calendars(text, text) authenticated",
      "grant access_company(text, text) authenticated",
      "revoke access_accounts_for(text, text) public, anon",
      "revoke access_accounts_totals() public, anon, authenticated",
      "revoke access_calendars(text, text) public, anon",
      "revoke access_calendars_of(uuid, uuid, text, text) public, anon, authenticated",
      "revoke access_company(text, text) public, anon",
      "revoke access_map_for(uuid, uuid, boolean) public, anon, authenticated",
      "revoke access_records_level(uuid, uuid, text) public, anon, authenticated",
    ]);
  });

  // По алфавиту 'off' > 'read': сравнение строк молча перевернуло бы права.
  test("levels are ranked by their place in the array; an unknown level opens nothing", () => {
    for (const fn of ["access_calendars_of", "access_company", "access_accounts_for"]) {
      const body = own(fn);
      hasClause(body, "min_rank integer := array_position(array['off', 'read', 'write'], p_min);", fn);
      assert.doesNotMatch(body, /level\s*(>=|<=|>|<|<>|=)\s*'(off|read|write)'/, fn);
      assert.doesNotMatch(body, /p_min\s*(>=|<=|>|<)/, fn);
    }
    hasClause(own("access_calendars_of"), "if p_tenant is null or p_user is null or min_rank is null or min_rank < 2 then return array[]::text[]; end if;", "calendars_of");
    hasClause(own("access_company"), "if caller is null or min_rank is null or min_rank < 2 then return false; end if;", "company");
    hasClause(own("access_accounts_for"), "if caller is null or min_rank is null or min_rank < 2 then return array[]::uuid[]; end if;", "accounts_for");
  });

  test("the calendar rule: unknown key, membership, owner, live, then the caller's own rows", () => {
    const body = own("access_calendars_of");
    hasClause(body, "select * into block_row from public.access_blocks b where b.key = p_block and b.scope = 'calendar'; if not found then return array[]::text[]; end if;", "block");
    hasClause(body, "select tm.role into member_role from public.tenant_members tm where tm.tenant_id = p_tenant and tm.user_id = p_user; if member_role is null then return array[]::text[]; end if;", "membership");
    hasClause(body, "if member_role = 'owner' then select coalesce(array_agg(t.id order by t.id), array[]::text[]) into granted from public.teams t where t.tenant_id = p_tenant; return granted; end if;", "owner");
    hasClause(body, "if not block_row.live or block_row.owner_only then return array[]::text[]; end if;", "live");
    hasClause(
      body,
      `select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[]) into granted
         from public.member_calendars mc
         left join public.member_access ma
           on ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id and ma.block = block_row.key and ma.team_id = mc.team_id
        where mc.tenant_id = p_tenant
          and mc.user_id = p_user
          and array_position(array['off', 'read', 'write'], coalesce(ma.level, block_row.levels[1])) >= min_rank
          and (block_row.key = 'calendar.records'
               or array_position(array['read', 'write'], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null);
       return granted;`,
      "employee rows",
    );
    before(body, "where b.key = p_block", "if member_role = 'owner' then", "an unknown key is open to the owner");
    before(body, "if member_role = 'owner' then", "if not block_row.live", "the owner is limited by a block that is not live yet");
    assert.doesNotMatch(body, /current_tenant_id|auth\.uid/, "the body must take identity from its arguments");
  });

  test("the public calendar rule reads identity once and delegates", () => {
    assert.equal(
      own("access_calendars"),
      norm(`declare caller uuid := auth.uid(); begin if caller is null then return array[]::text[]; end if;
            return public.access_calendars_of(public.current_tenant_id(), caller, p_block, p_min); end;`),
    );
  });

  test("the company rule: unknown key, membership, owner before live, own company row", () => {
    const body = own("access_company");
    hasClause(body, "where b.key = p_block and b.scope = 'company'; if not found then return false; end if;", "block");
    hasClause(body, "select tm.role into caller_role from public.tenant_members tm where tm.tenant_id = active_tenant and tm.user_id = caller; if caller_role is null then return false; end if;", "membership");
    hasClause(body, "if caller_role = 'owner' then return true; end if;", "owner");
    hasClause(body, "if not block_row.live or block_row.owner_only then return false; end if;", "live");
    hasClause(body, "select ma.level into stored_level from public.member_access ma where ma.tenant_id = active_tenant and ma.user_id = caller and ma.block = block_row.key and ma.team_id is null;", "own row");
    hasClause(body, "return coalesce(array_position(array['off', 'read', 'write'], coalesce(stored_level, block_row.levels[1])) >= min_rank, false);", "rank");
    before(body, "if not found then return false;", "if caller_role = 'owner' then", "an unknown key is open to the owner");
    before(body, "if caller_role = 'owner' then", "if not block_row.live", "the owner is limited by a block that is not live yet");
    assert.equal(count(body, "public.current_tenant_id()"), 1);
    assert.equal(count(body, "auth.uid()"), 1);
  });

  test("accounts by block: team accounts by calendar, shared accounts read-only by a linked calendar", () => {
    const body = own("access_accounts_for");
    hasClause(body, "if not exists (select 1 from public.access_blocks b where b.key = p_block and b.scope = 'calendar') then return array[]::uuid[]; end if;", "block");
    hasClause(body, "select tm.role into caller_role from public.tenant_members tm where tm.tenant_id = active_tenant and tm.user_id = caller; if caller_role is null then return array[]::uuid[]; end if;", "membership");
    hasClause(body, "if caller_role = 'owner' then select coalesce(array_agg(a.id order by a.id), array[]::uuid[]) into visible from public.accounts a where a.tenant_id = active_tenant; return visible; end if;", "owner");
    hasClause(body, "granted_calendars := public.access_calendars_of(active_tenant, caller, p_block, p_min);", "one calendar rule");
    hasClause(
      body,
      `select coalesce(array_agg(a.id order by a.id), array[]::uuid[]) into visible from public.accounts a
        where a.tenant_id = active_tenant
          and ((a.scope = 'team' and a.brigade_id = any(granted_calendars))
               or (min_rank = 2 and a.scope = 'company'
                   and exists (select 1 from public.account_teams att
                                where att.account_id = a.id and att.tenant_id = active_tenant and att.team_id = any(granted_calendars))));
       return visible;`,
      "employee accounts",
    );
    before(body, "where b.key = p_block", "if caller_role = 'owner' then", "an unknown key is open to the owner");
    assert.equal(count(body, "public.current_tenant_id()"), 1, "the active company is resolved once");
    assert.equal(count(body, "auth.uid()"), 1);
  });

  test("balances: team accounts by calendar, a shared account only when every linked calendar is visible", () => {
    const body = own("access_accounts_totals");
    hasClause(body, "granted_calendars := public.access_calendars_of(active_tenant, caller, 'finance.accounts', 'read');", "block");
    hasClause(body, "if caller_role = 'owner' then select coalesce(array_agg(a.id order by a.id), array[]::uuid[]) into visible from public.accounts a where a.tenant_id = active_tenant; return visible; end if;", "owner");
    hasClause(
      body,
      `where a.tenant_id = active_tenant
          and ((a.scope = 'team' and a.brigade_id = any(granted_calendars))
               or (a.scope = 'company'
                   and exists (select 1 from public.account_teams att where att.account_id = a.id and att.tenant_id = active_tenant)
                   and not exists (select 1 from public.account_teams att where att.account_id = a.id and not (att.team_id = any(granted_calendars)))));`,
      "employee totals",
    );
    hasClause(body, "select tm.role into caller_role from public.tenant_members tm where tm.tenant_id = active_tenant and tm.user_id = caller;", "membership");
    assert.equal(count(body, "public.current_tenant_id()"), 1);
  });
});

describe("a calendar gives nothing unless «Календарь и записи» is read or write", () => {
  test("the stored records level ignores liveness and reads only this person", () => {
    assert.equal(
      own("access_records_level"),
      norm(`select coalesce((select coalesce(ma.level, b.levels[1]) from public.access_blocks b
              left join public.member_access ma on ma.tenant_id = p_tenant and ma.user_id = p_user and ma.block = b.key and ma.team_id = p_team
             where b.key = 'calendar.records'), 'off')`),
    );
  });

  // Карта телефона и правило сервера обязаны решать одинаково.
  test("the phone map is the live body with exactly the two dependency lines swapped", () => {
    const previous = norm(previousDefinition("access_map_for").body);
    const expected = previous
      .replace(
        norm("coalesce(max(coalesce(ma.level, b.levels[1])) filter (where b.key = 'calendar.records'), 'off') as records_level"),
        norm("public.access_records_level(p_tenant_id, p_user_id, mc.team_id) as records_level"),
      )
      .replace(
        norm("where p_include_off or per_team.records_level <> 'off';"),
        norm("where p_include_off or array_position(array['read', 'write'], per_team.records_level) is not null;"),
      );
    assert.notEqual(expected, previous, "the previous body changed shape — recheck the hunks");
    assert.equal(own("access_map_for"), expected);
    assert.equal(latestDefinition("access_map_for").file, MIGRATION, "a later migration rewrote access_map_for");
  });
});

type Policy = {
  table: string;
  name: string;
  cmd: string;
  roles: string;
  using: string | null;
  check: string | null;
};

/** `(...)` at the start of `text`: the inside and what follows the closing parenthesis. */
function takeParenthesised(text: string, label: string): { inside: string; rest: string } {
  assert.equal(text[0], "(", `${label}: expected "("`);
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === "'") quoted = false;
    } else if (ch === "'") {
      quoted = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { inside: text.slice(1, i), rest: text.slice(i + 1).trimStart() };
    }
  }
  assert.fail(`${label}: unbalanced parentheses`);
}

/** Every `create policy` of the migration, clause by clause. */
function parsePolicies(): Policy[] {
  const policies: Policy[] = [];
  for (const match of sqlOnly.matchAll(/create policy [\s\S]*?;/g)) {
    const statement = match[0];
    const head = statement.match(/^create policy (\w+) on public\.(\w+)\s+for (select|insert|update|delete|all) to ([\w, ]+?)\s+(?=using|with check)/);
    assert.ok(head, `unparsable policy: ${statement.slice(0, 80)}`);
    let rest = statement.slice(head[0].length);
    let using: string | null = null;
    let check: string | null = null;
    if (rest.startsWith("using")) {
      const part = takeParenthesised(rest.slice("using".length).trimStart(), `${head[1]} using`);
      using = norm(part.inside);
      rest = part.rest;
    }
    if (rest.startsWith("with check")) {
      const part = takeParenthesised(rest.slice("with check".length).trimStart(), `${head[1]} with check`);
      check = norm(part.inside);
      rest = part.rest;
    }
    assert.equal(rest.trim(), ";", `${head[1]}: unexpected text after the clauses`);
    policies.push({ table: head[2] ?? "", name: head[1] ?? "", cmd: head[3] ?? "", roles: head[4] ?? "", using, check });
  }
  return policies;
}

const TENANT = "tenant_id = (select public.current_tenant_id())";
const OWNER = "(select public.current_user_role()) = 'owner'";
const SELF = "(select auth.uid())";
const calendars = (block: string, level: string) => `(select unnest(public.access_calendars('${block}', '${level}')))`;
const accountsFor = (block: string, level: string) => `(select unnest(public.access_accounts_for('${block}', '${level}')))`;
const anyCalendar = (block: string) => `(select cardinality(public.access_calendars('${block}', 'read'))) > 0`;
const debtIn = (level: string) =>
  `debt_id in (select d.id from public.debts d where d.tenant_id = (select public.current_tenant_id()) and d.team_id in ${calendars("finance.debts", level)})`;
const OPS_ACCOUNT = `(account_id is null or account_id in ${accountsFor("finance.operations", "write")})`;
const OPS_DEBT = `(debt_id is null or ${debtIn("write")})`;
const EXPENSE_ROW = [
  TENANT,
  `team_id in ${calendars("finance.operations", "write")}`,
  "type = 'expense'",
  "invoice_id is null",
  "refund_of_id is null",
  OPS_ACCOUNT,
  OPS_DEBT,
].join(" and ");

type Expected = { cmd: string; using?: string; check?: string };

/** The whole employee side of this slice. Anything else is a failure. */
const EXPECTED: Record<string, Expected> = {
  "finance_transactions.finance_transactions_select_calendar": {
    cmd: "select",
    using: `${TENANT} and team_id in ${calendars("finance.operations", "read")}`,
  },
  "finance_transactions.finance_transactions_select_debt": {
    cmd: "select",
    using: `${TENANT} and ${debtIn("read")}`,
  },
  "finance_transactions.finance_transactions_insert_calendar": {
    cmd: "insert",
    check: [
      TENANT,
      `team_id in ${calendars("finance.operations", "write")}`,
      "type in ('income', 'expense')",
      "invoice_id is null",
      "refund_of_id is null",
      "(type = 'expense' or appointment_id is null)",
      `created_by = ${SELF}`,
      OPS_ACCOUNT,
      OPS_DEBT,
    ].join(" and "),
  },
  "finance_transactions.finance_transactions_update_calendar": { cmd: "update", using: EXPENSE_ROW, check: EXPENSE_ROW },
  "finance_transactions.finance_transactions_delete_calendar": { cmd: "delete", using: EXPENSE_ROW },
  "day_extras.day_extras_select_calendar": {
    cmd: "select",
    using: `${TENANT} and team_id in ${calendars("finance.operations", "read")}`,
  },
  "accounts.accounts_select": {
    cmd: "select",
    using: `${TENANT} and (${OWNER} or brigade_id in ${calendars("finance.accounts", "read")} or id in ${accountsFor("finance.operations", "read")} or id in ${accountsFor("finance.accounts", "read")})`,
  },
  "accounts.accounts_insert_calendar": {
    cmd: "insert",
    check: `${TENANT} and brigade_id in ${calendars("finance.accounts", "write")} and (created_by is null or created_by = ${SELF})`,
  },
  "accounts.accounts_update_calendar": {
    cmd: "update",
    using: `${TENANT} and brigade_id in ${calendars("finance.accounts", "write")}`,
    check: `${TENANT} and brigade_id in ${calendars("finance.accounts", "write")}`,
  },
  "account_teams.account_teams_select_calendar": {
    cmd: "select",
    using: `${TENANT} and (team_id in ${calendars("finance.operations", "read")} or team_id in ${calendars("finance.accounts", "read")})`,
  },
  "finance_transfer_requests.finance_transfer_requests_select_calendar": {
    cmd: "select",
    using: `${TENANT} and array[from_account_id, to_account_id] <@ (select public.access_accounts_for('finance.accounts', 'read'))`,
  },
  "debts.debts_read": {
    cmd: "select",
    using: `${TENANT} and (${OWNER} or team_id in ${calendars("finance.debts", "read")})`,
  },
  "debts.debts_insert": {
    cmd: "insert",
    check: `${TENANT} and (${OWNER} or (team_id in ${calendars("finance.debts", "write")} and (created_by is null or created_by = ${SELF})))`,
  },
  "debts.debts_update": {
    cmd: "update",
    using: `${TENANT} and (${OWNER} or team_id in ${calendars("finance.debts", "write")})`,
    check: `${TENANT} and (${OWNER} or team_id in ${calendars("finance.debts", "write")})`,
  },
  "debts.debts_delete": {
    cmd: "delete",
    using: `${TENANT} and (${OWNER} or team_id in ${calendars("finance.debts", "write")})`,
  },
  "finance_categories.finance_categories_select_access": {
    cmd: "select",
    using: `(tenant_id is null or tenant_id = (select public.current_tenant_id())) and (${anyCalendar("finance.operations")} or ${anyCalendar("finance.debts")})`,
  },
  "finance_category_hidden.finance_category_hidden_select_access": {
    cmd: "select",
    using: `${TENANT} and (${anyCalendar("finance.operations")} or ${anyCalendar("finance.debts")})`,
  },
  "finance_category_order.finance_category_order_select_access": {
    cmd: "select",
    using: `${TENANT} and (${anyCalendar("finance.operations")} or ${anyCalendar("finance.debts")})`,
  },
  "finance_templates.finance_templates_select_access": {
    cmd: "select",
    using: `${TENANT} and brigade_id in ${calendars("finance.operations", "read")}`,
  },
  "team_finance_settings.team_finance_settings_select_access": {
    cmd: "select",
    using: `${TENANT} and team_id in ${calendars("finance.operations", "read")}`,
  },
};

describe("employee policies: the exact set, clause by clause", () => {
  const policies = parsePolicies();

  test("exactly these policies are created — no other table, name or command", () => {
    assert.deepEqual(
      policies.map((p) => `${p.table}.${p.name}:${p.cmd}`).sort(),
      Object.entries(EXPECTED).map(([key, e]) => `${key}:${e.cmd}`).sort(),
    );
  });

  test("each USING and WITH CHECK is exactly the expected condition", () => {
    for (const policy of policies) {
      const key = `${policy.table}.${policy.name}`;
      const expected = EXPECTED[key];
      assert.ok(expected, `unexpected policy ${key}`);
      assert.equal(policy.roles, "authenticated", `${key}: role`);
      assert.equal(policy.using, expected.using === undefined ? null : norm(expected.using), `${key}: using`);
      assert.equal(policy.check, expected.check === undefined ? null : norm(expected.check), `${key}: with check`);
    }
  });

  test("each created policy is dropped first; no policy is altered or dropped otherwise", () => {
    const drops = [...sqlOnly.matchAll(/drop policy if exists (\w+) on public\.(\w+);/g)].map((m) => `${m[2]}.${m[1]}`).sort();
    assert.deepEqual(drops, Object.keys(EXPECTED).sort());
    assert.equal(count(sqlOnly, "drop policy"), drops.length);
    assert.equal(count(sqlOnly, "create policy"), policies.length);
    assert.doesNotMatch(sqlOnly, /alter policy/);
    assert.doesNotMatch(sqlOnly, /(drop|create) policy (if exists )?\w*owner/);
  });

  // Голый вызов безопасной функции Postgres считает на каждую строку.
  test("no policy calls a rule bare or reaches an internal rule", () => {
    for (const policy of policies) {
      for (const clause of [policy.using, policy.check]) {
        if (clause === null) continue;
        const stripped = clause.replace(/\(select (?:unnest\(|cardinality\()?public\.access_(?:calendars|accounts_for)\(/g, "(select (");
        assert.doesNotMatch(stripped, /access_\w+\(/, `${policy.name}: bare or internal rule call`);
      }
    }
  });
});

/** Apply `[old, new]` hunks to a normalised body; each anchor must exist exactly once. */
function withHunks(body: string, hunks: readonly (readonly [string, string])[], label: string): string {
  let result = body;
  for (const [from, to] of hunks) {
    assert.equal(count(result, norm(from)), 1, `${label}: hunk anchor ${norm(from)}`);
    result = result.replace(norm(from), norm(to));
  }
  return result;
}

const OWNER_FILTER = [
  "caller_is_owner := coalesce(public.current_user_role() = 'owner', false);",
  "if not caller_is_owner then visible_accounts := public.access_accounts_totals(); end if;",
  "return query with ledger as",
].join(" ");

describe("owner-only money functions follow levels, and the owner path is byte for byte the old one", () => {
  test("account_balances = the live body plus the visible-accounts filter", () => {
    const expected = withHunks(norm(previousDefinition("account_balances").body), [
      [
        "tenant_uuid uuid := public.current_tenant_id(); begin if auth.uid() is null or public.current_user_role() is distinct from 'owner' then raise exception 'Балансы счетов доступны только владельцу'; end if;",
        "tenant_uuid uuid := public.current_tenant_id(); caller_is_owner boolean; visible_accounts uuid[]; begin if auth.uid() is null then raise exception 'Балансы счетов доступны только участникам компании'; end if;",
      ],
      ["return query with ledger as", OWNER_FILTER],
      [
        "where t.tenant_id = tenant_uuid group by t.account_id",
        "where t.tenant_id = tenant_uuid and (caller_is_owner or t.account_id = any(visible_accounts)) group by t.account_id",
      ],
      ["where a.tenant_id = tenant_uuid)", "where a.tenant_id = tenant_uuid and (caller_is_owner or a.id = any(visible_accounts)))"],
    ], "account_balances");
    assert.equal(own("account_balances"), expected);
    assert.equal(latestDefinition("account_balances").file, MIGRATION);
  });

  test("account_period_totals = the live body plus the visible-accounts filter", () => {
    const expected = withHunks(norm(previousDefinition("account_period_totals").body), [
      [
        "tenant_uuid uuid := public.current_tenant_id(); begin if auth.uid() is null or public.current_user_role() is distinct from 'owner' then raise exception 'Сводка по счетам доступна только владельцу'; end if;",
        "tenant_uuid uuid := public.current_tenant_id(); caller_is_owner boolean; visible_accounts uuid[]; begin if auth.uid() is null then raise exception 'Сводка по счетам доступна только участникам компании'; end if;",
      ],
      ["return query with ledger as", OWNER_FILTER],
      [
        "and t.occurred_on <= p_to group by t.account_id",
        "and t.occurred_on <= p_to and (caller_is_owner or t.account_id = any(visible_accounts)) group by t.account_id",
      ],
      ["where a.tenant_id = tenant_uuid)", "where a.tenant_id = tenant_uuid and (caller_is_owner or a.id = any(visible_accounts)))"],
    ], "account_period_totals");
    assert.equal(own("account_period_totals"), expected);
    assert.equal(latestDefinition("account_period_totals").file, MIGRATION);
  });

  test("replace_day_extras = the live body with the owner-only refusal split", () => {
    const expected = withHunks(norm(previousDefinition("replace_day_extras").body), [
      [
        "if auth.uid() is null or tenant_uuid is null or public.current_user_role() is distinct from 'owner' then raise exception 'Ручные финансы доступны только владельцу' using errcode = '42501'; end if;",
        `if auth.uid() is null or tenant_uuid is null then raise exception 'Ручные финансы доступны только участникам компании' using errcode = '42501'; end if;
         if public.current_user_role() is distinct from 'owner'
            and not coalesce(p_team_id = any(public.access_calendars('finance.operations', 'write')), false) then
           raise exception 'Менять доходы и расходы в этом календаре вам не открыто' using errcode = '42501', hint = 'block:finance.operations';
         end if;`,
      ],
    ], "replace_day_extras");
    assert.equal(own("replace_day_extras"), expected);
    assert.equal(latestDefinition("replace_day_extras").file, MIGRATION);
  });

  // Живые тела переводов расходятся с файлами миграций (правились в базе), поэтому
  // здесь проверяются сами правки, а тела сверял с живой базой второй ревьюер.
  test("a transfer needs write on both team accounts, checked before the replay path", () => {
    const record = own("record_account_transfer");
    hasClause(record, "if auth.uid() is null or tenant_uuid is null then raise exception 'Переводы между счетами доступны только участникам компании'; end if; caller_is_owner := coalesce(public.current_user_role() = 'owner', false);", "record entry");
    hasClause(
      record,
      `if not caller_is_owner then writable_accounts := public.access_accounts_for('finance.accounts', 'write');
         if not (p_from_account_id = any(writable_accounts) and p_to_account_id = any(writable_accounts)) then
           raise exception 'Перевод между этими счетами вам не открыт' using errcode = '42501', hint = 'block:finance.accounts';
         end if; end if;`,
      "record check",
    );
    before(record, "writable_accounts := public.access_accounts_for", "perform pg_advisory_xact_lock", "the replay of an existing request skips the access check");
    assert.equal(latestDefinition("record_account_transfer").file, MIGRATION);

    const remove = own("delete_account_transfer");
    hasClause(remove, "if auth.uid() is null or tenant_uuid is null then raise exception 'Отменить перевод может только участник компании'; end if; caller_is_owner := coalesce(public.current_user_role() = 'owner', false);", "delete entry");
    hasClause(
      remove,
      `if not caller_is_owner then writable_accounts := public.access_accounts_for('finance.accounts', 'write');
         if not (request_row.from_account_id = any(writable_accounts) and request_row.to_account_id = any(writable_accounts)) then
           raise exception 'Отменить перевод между этими счетами вам не открыто' using errcode = '42501', hint = 'block:finance.accounts';
         end if; end if; if request_row.status = 'deleted' then return false; end if;`,
      "delete check",
    );
    assert.equal(latestDefinition("delete_account_transfer").file, MIGRATION);
    for (const body of [record, remove]) {
      assert.doesNotMatch(body, /только владел/);
      assert.equal(count(body, "access_accounts"), 1);
    }
  });

  test("grants on the rewritten functions stay with signed-in users; the old import is closed", () => {
    for (const signature of [
      "account_balances(uuid)",
      "account_period_totals(uuid, date, date)",
      "record_account_transfer(uuid, uuid, uuid, numeric, date, text)",
      "delete_account_transfer(uuid)",
      "replace_day_extras(text, text, jsonb)",
    ]) {
      hasClause(norm(sqlOnly), `revoke all on function public.${signature} from public, anon;`, signature);
      hasClause(norm(sqlOnly), `grant execute on function public.${signature} to authenticated;`, signature);
    }
    hasClause(norm(sqlOnly), "revoke all on function public.import_schedule(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;", "import_schedule");
    assert.doesNotMatch(sqlOnly, /grant [^;]*import_schedule/);
  });
});

describe("scope stays with this slice", () => {
  // Эти функции переопределяет соседняя сессия в неприменённых миграциях.
  test("functions owned by the other session are not mentioned at all", () => {
    for (const name of [
      "reconcile_appointment_finance",
      "protect_paid_appointment_finance",
      "record_invoice_payment",
      "validate_invoice_payment_insert",
      "settle_appointment_from_invoice_payment",
      "protect_invoice_payment_row",
      "fill_transaction_vat",
      "cancel_invoice",
      "issue_invoice",
      "update_invoice_draft",
      "next_invoice_number",
      "prevent_settled_invoice_rewrite",
      "capture_invoice_document_snapshots",
      "enforce_plan_limits",
      "_issue_credit_note",
      "effective_vat_settings",
    ]) {
      assert.doesNotMatch(migration, new RegExp(String.raw`\b${name}\b`), name);
    }
  });

  test("documents, appointment payments and storage are later slices", () => {
    for (const name of [
      "record_appointment_payment",
      "cancel_appointment_payment",
      "reset_appointment_payment",
      "undo_appointment_payment",
      "set_appointment_prepayment",
      "current_user_can_pay_appointment",
      "resolve_appointment_payment_account",
      "record_cash_count",
      "list_payment_accounts_safe",
      "refund_invoice_payment",
      "void_invoice",
    ]) {
      assert.doesNotMatch(sqlOnly, new RegExp(String.raw`\b${name}\b`), name);
    }
    assert.doesNotMatch(sqlOnly, /public\.(invoices|invoice_lines|receipts|appointments|account_cash_counts|tenants)\b/);
    assert.doesNotMatch(sqlOnly, /\bstorage\./);
  });
});

describe("the registry, the signal and the guard", () => {
  const REGISTRY: Record<string, string[]> = {
    "finance.operations": [
      "policy:public.finance_transactions.finance_transactions_select_calendar",
      "policy:public.finance_transactions.finance_transactions_insert_calendar",
      "policy:public.finance_transactions.finance_transactions_update_calendar",
      "policy:public.finance_transactions.finance_transactions_delete_calendar",
      "policy:public.day_extras.day_extras_select_calendar",
      "function:public.replace_day_extras(text, text, jsonb)",
      "policy:public.accounts.accounts_select",
      "policy:public.account_teams.account_teams_select_calendar",
      "policy:public.finance_categories.finance_categories_select_access",
      "policy:public.finance_category_hidden.finance_category_hidden_select_access",
      "policy:public.finance_category_order.finance_category_order_select_access",
      "policy:public.finance_templates.finance_templates_select_access",
      "policy:public.team_finance_settings.team_finance_settings_select_access",
    ],
    "finance.accounts": [
      "policy:public.accounts.accounts_select",
      "policy:public.accounts.accounts_insert_calendar",
      "policy:public.accounts.accounts_update_calendar",
      "policy:public.account_teams.account_teams_select_calendar",
      "policy:public.finance_transfer_requests.finance_transfer_requests_select_calendar",
      "function:public.account_balances(uuid)",
      "function:public.account_period_totals(uuid, date, date)",
      "function:public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)",
      "function:public.delete_account_transfer(uuid)",
    ],
    "finance.debts": [
      "policy:public.debts.debts_read",
      "policy:public.debts.debts_insert",
      "policy:public.debts.debts_update",
      "policy:public.debts.debts_delete",
      "policy:public.finance_transactions.finance_transactions_select_debt",
      "policy:public.finance_transactions.finance_transactions_insert_calendar",
      "policy:public.finance_transactions.finance_transactions_update_calendar",
      "policy:public.finance_transactions.finance_transactions_delete_calendar",
      "policy:public.finance_categories.finance_categories_select_access",
      "policy:public.finance_category_hidden.finance_category_hidden_select_access",
      "policy:public.finance_category_order.finance_category_order_select_access",
    ],
  };

  test("exactly three finance blocks become live, each naming exactly where it is checked", () => {
    assert.equal(count(sqlOnly, "update public.access_blocks"), 3);
    const updates = [
      ...sqlOnly.matchAll(/update public\.access_blocks\s+set live = true,\s+enforced_by = array\[([\s\S]*?)\]\s+where key = '([^']+)';/g),
    ];
    const actual = Object.fromEntries(
      updates.map((m) => [m[2] ?? "", [...(m[1] ?? "").matchAll(/'([^']+)'/g)].map((e) => e[1] ?? "")]),
    );
    assert.deepEqual(actual, REGISTRY);
    for (const entry of Object.values(REGISTRY).flat()) {
      const policy = entry.match(/^policy:public\.(\w+)\.(\w+)$/);
      const fn = entry.match(/^function:public\.(\w+)\(/);
      assert.ok(policy ? EXPECTED[`${policy[1]}.${policy[2]}`] : fn && own(fn[1] ?? ""), entry);
    }
  });

  test("every employee's map changes, so every employee gets the signal", () => {
    hasClause(
      norm(sqlOnly),
      `for person in update public.tenant_members tm set access_version = tm.access_version + 1 where tm.role <> 'owner'
         returning tm.tenant_id, tm.user_id, tm.access_version
       loop perform realtime.send(jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version),
         'access_changed', 'access:' || person.user_id::text, true); end loop;`,
      "signal",
    );
  });

  test("the guard snapshots policies first, knows the exact set and checks what reviewers named", () => {
    const start = sqlOnly.indexOf("create temp table _finance_levels_policies_before as");
    assert.ok(start >= 0 && start < sqlOnly.indexOf("create or replace function"), "the snapshot is taken before any change");
    assert.match(sqlOnly, /drop table _finance_levels_policies_before;\s*$/);
    const guard = norm(sqlOnly.slice(sqlOnly.lastIndexOf("do $guard$")));
    const created = [...(guard.match(/v_created constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(created.sort(), Object.keys(EXPECTED).sort());
    for (const piece of [
      "if not (v_live @> array['finance.accounts', 'finance.debts', 'finance.operations']) then",
      "join public.finance_transactions paid_row on paid_row.id = refund_row.refund_of_id where refund_row.invoice_id is null and paid_row.invoice_id is not null",
      "where c = '(invoice_id IS NULL)'",
      "where c = '(refund_of_id IS NULL)'",
      "and coalesce(pp.qual, '') ~ v_owner and (pp.cmd = 'SELECT' or coalesce(pp.with_check, '') ~ v_owner)",
      "and b.qual is not distinct from pp.qual and b.with_check is not distinct from pp.with_check",
      "has_function_privilege('authenticated', 'public.import_schedule(jsonb, jsonb, jsonb, jsonb)', 'execute')",
      "where p_include_off or array_position(array[''read'', ''write''], per_team.records_level) is not null;",
      "if v_place ~ 'appointment_payment' then",
    ]) {
      assert.ok(guard.includes(norm(piece)), `guard lacks: ${piece}`);
    }
  });
});
