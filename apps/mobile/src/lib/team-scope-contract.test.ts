import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ВСЁ — У КОМАНДЫ (владелец 2026-09-24: «у нас всё отдельно под каждую
// команду, нет ничего общего; если увидишь общее между командами — сообщи;
// сделай на это проверку»).
//
// Тест собирает схему ИЗ МИГРАЦИЙ (create table / add column / drop column /
// set not null) и требует: каждая таблица с `tenant_id` несёт колонку
// команды, и эта колонка NOT NULL. Исключения — списками ниже, у каждого
// причина. Список TODO только СОКРАЩАЕТСЯ: таблица получила команду или
// удалена — строка обязана уйти, иначе тест красный. Новая таблица компании
// без команды — красный тест, пока ей не дали команду или не записали
// причину. Решения владельца 24.09 — в памяти `team-scope-decisions`.

const MIGRATIONS = join(__dirname, "../../../../supabase/migrations");
const TEAM_COLS = ["team_id", "brigade_id", "assigned_team_id"];

type Col = { notNull: boolean };
type Schema = Map<string, Map<string, Col>>;

/** Таблицы компании, у которых команды нет — и не должно быть. */
const EXEMPT: Record<string, string> = {
  teams: "это и есть команда",
  tenant_members: "членство в компании: роль и подписка",
  billing_events: "Stripe — платёж компании",
  push_subscriptions: "устройство человека",
  _finance_write_context: "технический пропуск, закрыт RLS",
  service_variants: "команда через services",
  appointment_photos: "команда через appointments",
  account_cash_counts: "команда через accounts",
  // Решения владельца 24.09 — едино на компанию:
  clients: "клиенты — единая база компании, по командам только сортируются",
  client_tags: "теги клиентов — едины на компанию",
  client_tag_assignments: "теги клиентов — едины на компанию",
  client_attachments: "файлы клиента — у клиента",
  location_requests: "запрос адреса у клиента — у клиента",
  companies: "реквизиты и нумерация инвойсов — едины на компанию",
  master_documents: "команда через masters",
  master_ratings: "команда через masters",
  master_rating_tokens: "команда через masters",
  tenant_sms_config: "баланс SMS — у компании, календари — списком team_ids",
  sms_topups: "пополнения баланса SMS компании",
};

/** НАРУШЕНИЯ, КОТОРЫЕ ЕЩЁ НЕ ИСПРАВЛЕНЫ. Только сокращается. */
const TODO_NO_TEAM: Record<string, string> = {
  calendar_settings: "часы, шаг, неделя, пояс — у команды («Дизайн» уже в team_design)",
  finance_category_hidden: "за категориями",
  finance_category_order: "за категориями",
  service_categories: "категории услуг — у команды",
  location_labels: "типы объектов — у команды",
  tenant_state: "SMS-шаблоны в prototype_state — у команды",
  // event_templates есть в базе, но в миграциях её нет (создана мимо
  // репозитория) — разбор её не видит; снести отдельной миграцией.
  tenant_loyalty_settings: "мёртвая таблица — снести",
  webhooks: "мёртвая таблица — снести",
  sms_logs: "устаревшая таблица — снести",
};

/** Колонки команды, которым законно быть пустыми. */
const NULLABLE_OK: Record<string, string> = {
  "appointments.team_id": "пусто = личное событие создателя",
  "member_access.team_id": "пусто = блок уровня компании (клиенты)",
  "invitations.team_id": "устарела, канон — team_ids[]",
  "finance_categories.team_id":
    "пусто — только у служебных категорий сервера (tenant_id is null); у категорий компании команду держит CHECK finance_categories_team_required",
};

/** Пустая команда там, где её быть не должно. Только сокращается. */
const TODO_NULLABLE: Record<string, string> = {
  "masters.team_id": "мастер прикреплён к команде",
  "recurring_reminders.team_id": "напоминание ТО — у команды",
  "sms_messages.team_id": "SMS — у календаря",
  "equipment.assigned_team_id": "склад — у команды",
};

const IDENT = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;
const SKIP_DEF = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;

/** Режет по запятым верхнего уровня (скобки CHECK и типов не рвутся). */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Тело функций ($$…$$) не схема — вырезаем, чтобы create table внутри
 *  plpgsql не путал разбор. */
function stripDollarBodies(sql: string): string {
  // DO-блоки — настоящие DDL («если пусто — set not null»): их тело
  // разворачиваем в поток операторов. Тела функций — вырезаем.
  const unwrapped = sql.replace(
    /\bdo\s+\$([a-z_]*)\$([\s\S]*?)\$\1\$/gi,
    (_m, _tag, body: string) => body,
  );
  return unwrapped.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "''");
}

export function parseSchema(files: { name: string; sql: string }[]): Schema {
  const schema: Schema = new Map();
  for (const { sql: raw } of files) {
    const sql = stripDollarBodies(stripComments(raw));
    for (const stmt of sql.split(";")) {
      const s = stmt.trim();
      let m = new RegExp(
        String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${IDENT}\s*\(([\s\S]*)\)`,
        "i",
      ).exec(s);
      if (m) {
        const cols = new Map<string, Col>();
        for (const def of splitTop(m[2])) {
          const d = def.trim();
          if (!d || SKIP_DEF.test(d)) continue;
          const cm = /^"?([a-z_][a-z0-9_]*)"?\s/i.exec(d);
          if (!cm) continue;
          cols.set(cm[1].toLowerCase(), {
            notNull: /\bnot\s+null\b|\bprimary\s+key\b/i.test(d),
          });
        }
        schema.set(m[1].toLowerCase(), cols);
        continue;
      }
      m = new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${IDENT}`, "i").exec(s);
      if (m) {
        schema.delete(m[1].toLowerCase());
        continue;
      }
      // Без якоря: внутри DO-блока оператору предшествует «if … then».
      m = new RegExp(
        String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${IDENT}\s+([\s\S]*)$`,
        "i",
      ).exec(s);
      if (!m) continue;
      const table = m[1].toLowerCase();
      const rest = m[2];
      const ren = /^rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/i.exec(rest);
      if (ren) {
        const cols = schema.get(table);
        if (cols) {
          schema.delete(table);
          schema.set(ren[1].toLowerCase(), cols);
        }
        continue;
      }
      const cols = schema.get(table);
      if (!cols) continue;
      const rc = /^rename\s+(?:column\s+)?"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/i.exec(rest);
      if (rc) {
        const col = cols.get(rc[1].toLowerCase());
        if (col) {
          cols.delete(rc[1].toLowerCase());
          cols.set(rc[2].toLowerCase(), col);
        }
        continue;
      }
      for (const action of splitTop(rest)) {
        const a = action.trim();
        let am = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*)$/i.exec(a);
        if (am && !SKIP_DEF.test(am[1])) {
          cols.set(am[1].toLowerCase(), {
            notNull: /\bnot\s+null\b|\bprimary\s+key\b/i.test(am[2]),
          });
          continue;
        }
        am = /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i.exec(a);
        if (am && !/^drop\s+(constraint|not|default)\b/i.test(a)) {
          cols.delete(am[1].toLowerCase());
          continue;
        }
        am = /^alter\s+(?:column\s+)?"?([a-z_][a-z0-9_]*)"?\s+(set|drop)\s+not\s+null/i.exec(a);
        if (am) {
          const col = cols.get(am[1].toLowerCase());
          if (col) col.notNull = am[2].toLowerCase() === "set";
        }
      }
    }
  }
  return schema;
}

function loadSchema(): Schema {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
  return parseSchema(files);
}

function teamColumn(cols: Map<string, Col>): [string, Col] | null {
  for (const name of TEAM_COLS) {
    const col = cols.get(name);
    if (col) return [name, col];
  }
  return null;
}

describe("всё у команды — контракт схемы (владелец 24.09)", () => {
  const schema = loadSchema();
  const tenantTables = [...schema.entries()].filter(([, cols]) => cols.has("tenant_id"));

  test("разбор миграций видит схему", () => {
    // Сторож разбора: без этих таблиц проверка ниже была бы пустой.
    for (const t of ["appointments", "services", "clients", "finance_transactions"]) {
      assert.ok(schema.get(t)?.has("tenant_id"), `разбор не нашёл ${t}.tenant_id`);
    }
    assert.equal(schema.get("services")?.get("team_id")?.notNull, true);
  });

  test("каждая таблица компании — у команды, или причина записана", () => {
    const missing = tenantTables
      .filter(([name, cols]) => !teamColumn(cols) && !(name in EXEMPT) && !(name in TODO_NO_TEAM))
      .map(([name]) => name);
    assert.deepEqual(
      missing,
      [],
      "Таблица компании без команды. Добавьте team_id NOT NULL + FK на teams " +
        "или запишите причину в EXEMPT (решение владельца).",
    );
  });

  test("команда не бывает пустой, кроме записанных случаев", () => {
    const bad = tenantTables
      .map(([name, cols]) => [name, teamColumn(cols)] as const)
      .filter(([, tc]) => tc && !tc[1].notNull)
      .map(([name, tc]) => `${name}.${tc![0]}`)
      .filter((key) => !(key in NULLABLE_OK) && !(key in TODO_NULLABLE));
    assert.deepEqual(bad, [], "Пустая команда недопустима: сделайте колонку NOT NULL.");
  });

  test("списки долгов только сокращаются — исправленное уходит из списка", () => {
    const staleNoTeam = Object.keys(TODO_NO_TEAM).filter((name) => {
      const cols = schema.get(name);
      return !cols || teamColumn(cols) != null;
    });
    const staleNullable = Object.keys(TODO_NULLABLE).filter((key) => {
      const [name, col] = key.split(".");
      const c = schema.get(name)?.get(col);
      return !c || c.notNull;
    });
    const staleExempt = Object.keys(EXEMPT).filter((name) => !schema.has(name));
    assert.deepEqual(
      [...staleNoTeam, ...staleNullable, ...staleExempt],
      [],
      "Эти строки больше не нужны — уберите их из списка.",
    );
  });

  test("мутант: новая таблица компании без команды ловится", () => {
    const mutant = parseSchema([
      { name: "x.sql", sql: "create table public.brand_new (id uuid primary key, tenant_id uuid not null);" },
    ]);
    const cols = mutant.get("brand_new");
    assert.ok(cols?.has("tenant_id"));
    assert.equal(teamColumn(cols!), null);
    const nullable = parseSchema([
      { name: "y.sql", sql: "create table t (tenant_id uuid, team_id text); alter table t alter column team_id set not null;" },
    ]);
    assert.equal(nullable.get("t")?.get("team_id")?.notNull, true);
  });
});
