import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ДОХОДЫ И РАСХОДЫ — ДВА ПРАВА (срез 2а, 29.09). Сторож миграции проверяет
// каталог один раз на накате; этот тест — каждый раз, когда кто-то перепишет
// политику или функцию в обход. Условия сравниваются ЦЕЛИКОМ (пробелы
// схлопнуты, комментарии сняты): поиск меток через includes пропускал «or
// true» и «write» вместо «read» (урок сторожа 15.09).

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "20260929235000_finance_income_expense_levels.sql";
const migration = readFileSync(join(resolve(here, "../../../../../supabase/migrations"), MIGRATION), "utf8");

/** SQL без `--` комментариев: пояснение не должно ни выполнять, ни ломать проверку. */
const sqlOnly = migration.replace(/--[^\n]*$/gm, "");

function norm(sql: string): string {
  return sql
    .replace(/--[^\n]*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** Тело функции, как его задаёт этот файл (ровно один раз). */
function own(fn: string): string {
  const matches = [
    ...migration.matchAll(
      new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${fn}\([\s\S]*?\bAS \$function\$([\s\S]*?)\$function\$`, "g"),
    ),
  ];
  assert.equal(matches.length, 1, `${MIGRATION} must define public.${fn} exactly once`);
  return norm(matches[0]?.[1] ?? "");
}

type Policy = { table: string; name: string; cmd: string; roles: string; using: string | null; check: string | null };

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
const cal = (block: string, level: string) => `(select unnest(public.access_calendars('${block}', '${level}')))`;
const acc = (block: string, level: string) => `(select unnest(public.access_accounts_for('${block}', '${level}')))`;
const anyCal = (block: string) => `(select cardinality(public.access_calendars('${block}', 'read'))) > 0`;
const account = (block: string) => `(account_id is null or account_id in ${acc(block, "write")})`;
const DEBT_OF_TEAM = `debt_id in (select d.id from public.debts d where d.tenant_id = (select public.current_tenant_id()) and d.team_id in ${cal("finance.debts", "write")})`;

/** «Правит всё» — любую строку команды, «Добавляет» — только свою. */
const whoEdits = (block: string) =>
  `(team_id in ${cal(block, "full")} or (team_id in ${cal(block, "write")} and created_by = ${SELF}))`;

const INCOME_ROW = [
  TENANT,
  "type = 'income'",
  "invoice_id is null",
  "refund_of_id is null",
  "appointment_id is null",
  "debt_id is null",
  whoEdits("finance.income"),
  account("finance.income"),
].join(" and ");

const EXPENSE_ROW = [
  TENANT,
  "type = 'expense'",
  "invoice_id is null",
  "refund_of_id is null",
  "debt_id is null",
  whoEdits("finance.expense"),
  account("finance.expense"),
].join(" and ");

const DEBT_ROW = [
  TENANT,
  `team_id in ${cal("finance.debts", "write")}`,
  "type in ('income', 'expense')",
  DEBT_OF_TEAM,
  "invoice_id is null",
  "refund_of_id is null",
  "(type = 'expense' or appointment_id is null)",
  `created_by = ${SELF}`,
  account("finance.debts"),
].join(" and ");

type Expected = { cmd: string; using?: string; check?: string };

/** Вся сторона сотрудника этого среза. Что-то сверх — провал. */
const EXPECTED: Record<string, Expected> = {
  "finance_transactions.finance_transactions_select_calendar": {
    cmd: "select",
    using: `${TENANT} and ((type in ('income', 'refund') and team_id in ${cal("finance.income", "read")}) or (type = 'expense' and team_id in ${cal("finance.expense", "read")}) or (type = 'transfer' and team_id in ${cal("finance.accounts", "read")}))`,
  },
  "finance_transactions.finance_transactions_insert_income": {
    cmd: "insert",
    check: [
      TENANT,
      `team_id in ${cal("finance.income", "write")}`,
      "type = 'income'",
      "invoice_id is null",
      "refund_of_id is null",
      "appointment_id is null",
      "debt_id is null",
      `created_by = ${SELF}`,
      account("finance.income"),
    ].join(" and "),
  },
  "finance_transactions.finance_transactions_insert_expense": {
    cmd: "insert",
    check: [
      TENANT,
      `team_id in ${cal("finance.expense", "write")}`,
      "type = 'expense'",
      "invoice_id is null",
      "refund_of_id is null",
      "debt_id is null",
      `created_by = ${SELF}`,
      account("finance.expense"),
    ].join(" and "),
  },
  "finance_transactions.finance_transactions_insert_debt": { cmd: "insert", check: DEBT_ROW },
  "finance_transactions.finance_transactions_update_income": { cmd: "update", using: INCOME_ROW, check: INCOME_ROW },
  "finance_transactions.finance_transactions_delete_income": { cmd: "delete", using: INCOME_ROW },
  "finance_transactions.finance_transactions_update_expense": { cmd: "update", using: EXPENSE_ROW, check: EXPENSE_ROW },
  "finance_transactions.finance_transactions_delete_expense": { cmd: "delete", using: EXPENSE_ROW },
  "finance_transactions.finance_transactions_update_debt": { cmd: "update", using: DEBT_ROW, check: DEBT_ROW },
  "finance_transactions.finance_transactions_delete_debt": { cmd: "delete", using: DEBT_ROW },
  "day_extras.day_extras_select_calendar": {
    cmd: "select",
    using: `${TENANT} and ((kind = 'income' and team_id in ${cal("finance.income", "read")}) or (kind = 'expense' and team_id in ${cal("finance.expense", "read")}))`,
  },
  "accounts.accounts_select": {
    cmd: "select",
    using: `${TENANT} and (${OWNER} or brigade_id in ${cal("finance.accounts", "read")} or id in ${acc("finance.income", "read")} or id in ${acc("finance.expense", "read")} or id in ${acc("finance.accounts", "read")})`,
  },
  "account_teams.account_teams_select_calendar": {
    cmd: "select",
    using: `${TENANT} and (team_id in ${cal("finance.income", "read")} or team_id in ${cal("finance.expense", "read")} or team_id in ${cal("finance.accounts", "read")})`,
  },
  "finance_categories.finance_categories_select_access": {
    cmd: "select",
    using: `(tenant_id is null and (${anyCal("finance.income")} or ${anyCal("finance.expense")} or ${anyCal("finance.debts")})) or (${TENANT} and (team_id in ${cal("finance.income", "read")} or team_id in ${cal("finance.expense", "read")} or team_id in ${cal("finance.debts", "read")}))`,
  },
  "finance_category_hidden.finance_category_hidden_select_access": {
    cmd: "select",
    using: `${TENANT} and (${anyCal("finance.income")} or ${anyCal("finance.expense")} or ${anyCal("finance.debts")})`,
  },
  "finance_category_order.finance_category_order_select_access": {
    cmd: "select",
    using: `${TENANT} and (${anyCal("finance.income")} or ${anyCal("finance.expense")} or ${anyCal("finance.debts")})`,
  },
  "finance_templates.finance_templates_select_access": {
    cmd: "select",
    using: `${TENANT} and (brigade_id in ${cal("finance.income", "read")} or brigade_id in ${cal("finance.expense", "read")})`,
  },
  "team_finance_settings.team_finance_settings_select_access": {
    cmd: "select",
    using: `${TENANT} and (team_id in ${cal("finance.income", "read")} or team_id in ${cal("finance.expense", "read")})`,
  },
};

describe("срез 2а: политики сотрудника — точный набор, условие за условием", () => {
  const policies = parsePolicies();

  test("создаются ровно эти политики", () => {
    assert.deepEqual(
      policies.map((p) => `${p.table}.${p.name}:${p.cmd}`).sort(),
      Object.entries(EXPECTED).map(([key, e]) => `${key}:${e.cmd}`).sort(),
    );
  });

  test("каждое USING и WITH CHECK — ровно ожидаемое условие", () => {
    for (const policy of policies) {
      const key = `${policy.table}.${policy.name}`;
      const expected = EXPECTED[key];
      assert.ok(expected, `unexpected policy ${key}`);
      assert.equal(policy.roles, "authenticated", `${key}: role`);
      assert.equal(policy.using, expected.using === undefined ? null : norm(expected.using), `${key}: using`);
      assert.equal(policy.check, expected.check === undefined ? null : norm(expected.check), `${key}: with check`);
    }
  });

  test("каждая пересоздаётся после drop; общие политики записи операций сносятся", () => {
    const drops = [...sqlOnly.matchAll(/drop policy if exists (\w+) on public\.(\w+);/g)].map((m) => `${m[2]}.${m[1]}`).sort();
    const created = policies.filter((p) => drops.includes(`${p.table}.${p.name}`)).map((p) => `${p.table}.${p.name}`);
    const expectedDrops = [
      ...created,
      "finance_transactions.finance_transactions_insert_calendar",
      "finance_transactions.finance_transactions_update_calendar",
      "finance_transactions.finance_transactions_delete_calendar",
    ].sort();
    assert.deepEqual(drops, expectedDrops);
    assert.doesNotMatch(sqlOnly, /alter policy/);
    assert.doesNotMatch(sqlOnly, /(drop|create) policy (if exists )?\w*owner/);
  });

  test("правило в политике — только подзапросом: голый вызов считается на каждую строку", () => {
    for (const policy of policies) {
      for (const clause of [policy.using, policy.check]) {
        if (clause === null) continue;
        const stripped = clause.replace(/\(select (?:unnest\(|cardinality\()?public\.access_(?:calendars|accounts_for)\(/g, "(select (");
        assert.doesNotMatch(stripped, /access_\w+\(/, `${policy.name}: bare rule call`);
      }
    }
  });

  test("общий ключ «Доходы и расходы» не спрашивает ни одна политика", () => {
    for (const policy of policies) {
      assert.doesNotMatch(`${policy.using} ${policy.check}`, /finance\.operations/, policy.name);
    }
  });
});

describe("срез 2а: ступень «Правит всё» и функции", () => {
  test("шкала ['off', 'read', 'write', 'full'] в трёх правилах, старой шкалы нет", () => {
    for (const fn of ["access_calendars_of", "access_company", "access_accounts_for"]) {
      const body = own(fn);
      assert.ok(count(body, "array['off', 'read', 'write', 'full']") >= 1, fn);
      assert.equal(count(body.replaceAll("array['off', 'read', 'write', 'full']", ""), "array['off', 'read', 'write']"), 0, fn);
      assert.doesNotMatch(body, /level\s*(>=|<=|>|<)\s*'(off|read|write|full)'/, `${fn}: string comparison`);
    }
    // Зависимость от «Календаря и записей» не трогается: у того блока full не бывает.
    assert.equal(count(own("access_calendars_of"), "array['read', 'write'], public.access_records_level"), 1);
    // Общий счёт компании — только на чтение: ранг read = 2 не сдвинулся.
    assert.equal(count(own("access_accounts_for"), "min_rank = 2 and a.scope = 'company'"), 1);
  });

  test("файл задаёт ровно пять функций", () => {
    const defined = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
    assert.deepEqual(defined, ["access_accounts_for", "access_calendars_of", "access_company", "issue_receipt", "replace_day_extras"]);
    assert.doesNotMatch(sqlOnly, /\b(grant|revoke)\b/, "create or replace keeps grants");
  });

  test("чек: ручной доход — «Правит всё» любой, «Добавляет» свой; оплата долга — «Долгами»", () => {
    const body = own("issue_receipt");
    assert.doesNotMatch(body, /finance\.operations/);
    const debt = body.indexOf("elsif tx.debt_id is not null then");
    const manual = body.indexOf("else allowed :=", debt);
    assert.ok(debt > 0 && manual > debt, "ветка долга стоит до ветки ручного дохода");
    const debtBranch = body.slice(debt, manual);
    assert.equal(count(debtBranch, "tx.team_id = any(public.access_calendars('finance.debts', 'write'))"), 1);
    assert.equal(count(debtBranch, "tx.account_id = any(public.access_accounts_for('finance.debts', 'write'))"), 1);
    assert.doesNotMatch(debtBranch, /finance\.income/);
    const manualBranch = body.slice(manual, body.indexOf("end if;", manual));
    // Автор старых доходов пуст: `=` дало бы NULL и пропустило чек мимо права
    // (поймано прогоном 29.09), поэтому только `is not distinct from`.
    assert.ok(
      manualBranch.includes(
        norm(`(tx.team_id = any(public.access_calendars('finance.income', 'full'))
              or (tx.team_id = any(public.access_calendars('finance.income', 'write')) and tx.created_by is not distinct from auth.uid()))`),
      ),
      "«Добавляет» — только свой доход",
    );
    assert.doesNotMatch(body, /created_by = auth\.uid\(\)/, "сравнение автора, которое на NULL молчит");
    assert.equal(count(body, "if allowed is not true then raise exception"), 1, "отказ на всё, что не «да»");
    assert.doesNotMatch(body, /if not allowed then/);
  });

  test("ручной день: пишутся только свои стороны, чужая строка — лишь нетронутой, отдаётся видимое", () => {
    const body = own("replace_day_extras");
    assert.doesNotMatch(body, /finance\.operations/);
    const lock = body.indexOf("perform pg_advisory_xact_lock(");
    const sides = body.indexOf("into writable");
    const foreign = body.indexOf("for foreign_item in");
    const wipe = body.indexOf("delete from public.day_extras extra");
    assert.ok(lock > 0 && lock < sides && sides < foreign && foreign < wipe, "стороны и чужие строки — под замком и до удаления");
    assert.equal(count(body, "public.access_calendars('finance.' || side.kind, 'write')"), 1);
    assert.equal(count(body, "public.access_calendars('finance.' || side.kind, 'read')"), 1);
    // Чужая строка пропускается, только если лежит в дне ровно такой же.
    for (const field of [
      "extra.id = (foreign_item ->> 'id')::uuid",
      "extra.kind = foreign_item ->> 'kind'",
      "extra.name = btrim(foreign_item ->> 'name')",
      "extra.amount = (foreign_item ->> 'amount')::numeric",
      "extra.category is not distinct from (foreign_item ->> 'category')",
      "extra.payment_method is not distinct from (foreign_item ->> 'payment_method')",
      "extra.receipt_url is not distinct from (foreign_item ->> 'receipt_url')",
    ]) {
      assert.equal(count(body, field), 1, field);
    }
    assert.equal(count(body, "hint = 'block:finance.' || (foreign_item ->> 'kind')"), 1);
    // Стирает и пишет только свои стороны, отдаёт — только видимые.
    assert.ok(body.includes("and extra.date = p_date and extra.kind = any(writable);"), "delete по своим сторонам");
    assert.ok(body.includes("from jsonb_array_elements(p_extras) where (value ->> 'kind') = any(writable);"), "insert своих сторон");
    assert.ok(body.includes("and extra.kind = any(readable) order by extra.created_at, extra.id;"), "ответ — видимое");
  });
});

describe("срез 2а: реестр, перенос и сторож", () => {
  test("две живые стороны с четырьмя ступенями; общий блок гаснет", () => {
    for (const [key, title] of [
      ["finance.income", "Доходы"],
      ["finance.expense", "Расходы"],
    ] as const) {
      assert.match(norm(sqlOnly), new RegExp(String.raw`'${key.replace(".", "\\.")}', 'finance', 'calendar', array\['off', 'read', 'write', 'full'\], '${title}', false, true`));
    }
    assert.ok(norm(sqlOnly).includes("update public.access_blocks set live = false, enforced_by = array[]::text[] where key = 'finance.operations';"));
  });

  test("перенос: «Меняет» → доходы «Добавляет», расходы «Правит всё» — в правах, шаблонах и приглашениях", () => {
    const text = norm(sqlOnly);
    assert.equal(count(text, "case when side.block = 'finance.expense' and ma.level = 'write' then 'full' else ma.level end"), 1);
    assert.equal(count(text, "case when t.levels ->> 'finance.operations' = 'write' then to_jsonb('full'::text) else t.levels -> 'finance.operations' end"), 1);
    assert.equal(count(text, "case when side.block = 'finance.expense' and change ->> 'level' = 'write' then 'full' else change ->> 'level' end"), 1);
    assert.equal(count(text, "on conflict (tenant_id, user_id, block, team_id) do nothing"), 1);
  });

  test("сигнал всем сотрудникам и сторож с запретом старого ключа", () => {
    const text = norm(sqlOnly);
    assert.ok(text.includes("perform realtime.send(jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version), 'access_changed', 'access:' || person.user_id::text, true);"));
    const guard = norm(sqlOnly.slice(sqlOnly.lastIndexOf("do $guard$")));
    for (const piece of [
      "and p.prosrc like '%finance.operations%'",
      "like '%finance.operations%'; if v_left is not null then raise exception 'сторож: политики ещё спрашивают finance.operations: %', v_left;",
      "to_regprocedure(substr(v_entry, length('function:') + 1)) is null",
    ]) {
      assert.ok(guard.includes(norm(piece)), `guard lacks: ${piece}`);
    }
    const listed = [...(guard.match(/v_policies constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const key of Object.keys(EXPECTED)) assert.ok(listed.includes(key), `guard does not check ${key}`);
  });
});
