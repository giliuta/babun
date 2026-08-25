// Договор между КЛИЕНТСКИМ payload и БЕЛЫМ СПИСКОМ атомарных RPC.
//
// Функции `create_client_with_tags` / `update_client_with_tags` перечисляют
// разрешённые ключи и отвечают 22023 «client payload contains a protected or
// unknown field» на любой лишний. Раньше это соответствие держалось на
// внимательности: 2026-08-08 в payload добавили `purge_at`, белый список о нём
// не знал — и СОЗДАНИЕ КЛИЕНТА перестало работать целиком, на 17 дней, без
// единого падающего теста.
//
// Тест сравнивает то, что репозиторий реально кладёт в RPC, с последним
// определением белого списка в миграциях. Миграция ищется по тексту, а не по
// имени: следующая, которая перепишет функции, подхватится сама.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "../../local/clients";
import { createClient, updateClient } from "./clients";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../apps/web/supabase/migrations",
);

// В кавычках — так это ищет именно `raise exception`, а не комментарий,
// который цитирует то же сообщение «ёлочками».
const CREATE_MARKER = "'client payload contains a protected or unknown field'";
const UPDATE_MARKER = "'client patch contains a protected or unknown field'";

/** Последняя по порядку миграция, которая переопределяет обе функции. */
function latestRpcMigration(): string {
  const named = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();
  for (const name of named) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    if (sql.includes(CREATE_MARKER) && sql.includes(UPDATE_MARKER)) return sql;
  }
  throw new Error("no migration defines the client write whitelists");
}

/** Ключи из `key not in ( … )` перед указанным сообщением об ошибке. */
function whitelist(sql: string, marker: string): Set<string> {
  const end = sql.indexOf(marker);
  const start = sql.lastIndexOf("key not in", end);
  if (end < 0 || start < 0) throw new Error(`whitelist not found for ${marker}`);
  const block = sql.slice(start, end);
  return new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!));
}

const sql = latestRpcMigration();
const CREATE_ALLOWED = whitelist(sql, CREATE_MARKER);
const UPDATE_ALLOWED = whitelist(sql, UPDATE_MARKER);

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

/** Клиент со ВСЕМИ заполненными полями: пустые поля ничего не проверяют —
 *  маппер обязан протащить каждое, иначе тест ловит не тот payload. */
const fullClient: Client = {
  id: CLIENT_ID,
  full_name: "Анна Клиент",
  phone: "+35799000000",
  whatsapp_phone: "+35799000001",
  email: "a@example.com",
  sms_name: "Анна",
  telegram_username: "anna",
  instagram_username: "anna",
  balance: 100,
  discount: 5,
  comment: "комментарий",
  acquisition_source: "referral",
  referred_by_client_id: null,
  first_contact_date: "2026-01-01",
  address: "Улица 1",
  city: "Лимасол",
  city_manual: true,
  property_type: "house",
  birthday: "1990-01-01",
  blacklisted: false,
  pinned_at: "2026-08-01T10:00:00.000Z",
  reminder_at: "2026-08-02T10:00:00.000Z",
  phones: [],
  locations: [],
  notes: [],
  equipment: [],
  tag_ids: [],
  phone_e164: "+35799000000",
  avatar_url: null,
  deleted_at: "2026-08-08T10:00:00.000Z",
  purge_at: "2026-09-07T10:00:00.000Z",
  favorite_master_id: null,
  created_at: "2026-07-20T12:00:00.000Z",
};

const serverRow = {
  ...fullClient,
  tenant_id: TENANT,
  updated_at: "2026-07-20T12:01:00.000Z",
};

function recordingSupabase(calls: Record<string, unknown>[]) {
  return {
    rpc(_name: string, args: Record<string, unknown>) {
      calls.push(args);
      return Promise.resolve({ data: serverRow, error: null });
    },
    from() {
      throw new Error("legacy fallback must not run");
    },
  } as never;
}

describe("client write payload matches the RPC whitelist", () => {
  test("create sends only keys the function accepts", async () => {
    const calls: Record<string, unknown>[] = [];
    await createClient(recordingSupabase(calls), fullClient, TENANT);
    const payload = calls[0]?.p_client as Record<string, unknown>;
    const rejected = Object.keys(payload).filter((k) => !CREATE_ALLOWED.has(k));
    expect(rejected).toEqual([]);
  });

  test("update sends only keys the function accepts", async () => {
    const calls: Record<string, unknown>[] = [];
    await updateClient(recordingSupabase(calls), CLIENT_ID, fullClient, TENANT);
    const patch = calls[0]?.p_patch as Record<string, unknown>;
    const rejected = Object.keys(patch).filter((k) => !UPDATE_ALLOWED.has(k));
    expect(rejected).toEqual([]);
  });

  test("purge_at stays a server-side lifecycle field", () => {
    expect(CREATE_ALLOWED.has("purge_at")).toBe(false);
    expect(UPDATE_ALLOWED.has("purge_at")).toBe(false);
  });
});
