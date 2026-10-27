import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  CALENDAR_WORK_SOURCES,
  calendarHasWork,
  paidCalendarCount,
  type WorkClient,
  type WorkQuery,
} from "@/session/calendar-price";

// ПЛАТИТ КАЛЕНДАРЬ С РАБОТОЙ — ОДИНАКОВО НА ЭКРАНЕ И В STRIPE.
//
// Живой календарь платит, если в нём есть запись (`kind = 'work'`), операция
// финансов или SMS; календарь только с событиями бесплатен. Правило живёт в
// двух местах: приложение считает само (`calendar-price.ts`, страница «Тариф»
// и предложение «Новый календарь»), сервер — функцией базы
// `paid_calendar_count` (её зовут `tariff-checkout` и `stripe-webhook`).
// Разойдутся — человек увидит одну сумму, а Stripe спишет другую.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const migrationFile = [
  ...readdirSync(path.join(ROOT, "supabase/migrations")).map((f) => `supabase/migrations/${f}`),
  ...readdirSync(path.join(ROOT, "supabase/parked")).map((f) => `supabase/parked/${f}`),
].find((f) => f.endsWith("_paid_calendar_count.sql"));
const SQL = migrationFile ? read(migrationFile) : "";
const FN = read("supabase/functions/tariff-checkout/index.ts");
const WEBHOOK = read("supabase/functions/stripe-webhook/index.ts");
const HELPER = read("supabase/functions/_shared/paid-calendars.ts");

type Row = { table: string; tenant_id: string; team_id: string; kind?: string };

/** Клиент в памяти: `select → eq… → limit` по строкам фикстуры. */
function fakeClient(rows: Row[], fail?: string): WorkClient {
  return {
    from(table) {
      const filters: [string, string][] = [];
      const query: WorkQuery = {
        select: () => query,
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        limit(count) {
          if (fail === table) return Promise.resolve({ data: null, error: { message: `${table} denied` } });
          const hit = rows.filter(
            (r) => r.table === table && filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
          );
          return Promise.resolve({ data: hit.slice(0, count), error: null });
        },
      };
      return query;
    },
  };
}

const T = "tenant-1";
const event = (team: string): Row => ({ table: "appointments", tenant_id: T, team_id: team, kind: "event" });
const personal = (team: string): Row => ({ table: "appointments", tenant_id: T, team_id: team, kind: "personal" });
const work = (team: string): Row => ({ table: "appointments", tenant_id: T, team_id: team, kind: "work" });
const operation = (team: string): Row => ({ table: "finance_transactions", tenant_id: T, team_id: team });
const sms = (team: string): Row => ({ table: "sms_messages", tenant_id: T, team_id: team });

describe("какой календарь платит", () => {
  test("только события — бесплатно, как бы календарь ни назывался", async () => {
    const client = fakeClient([event("personal"), personal("personal"), event("personal")]);
    assert.equal(await calendarHasWork(client, T, "personal"), false);
    assert.equal(await calendarHasWork(client, T, "empty-hidden"), false);
  });

  test("есть запись (work) — платит", async () => {
    const client = fakeClient([event("crew"), work("crew")]);
    assert.equal(await calendarHasWork(client, T, "crew"), true);
  });

  test("есть только операция финансов — платит; только SMS — тоже", async () => {
    assert.equal(await calendarHasWork(fakeClient([event("cash"), operation("cash")]), T, "cash"), true);
    assert.equal(await calendarHasWork(fakeClient([sms("sms")]), T, "sms"), true);
  });

  test("чужой аккаунт и чужой календарь не засчитываются", async () => {
    const client = fakeClient([{ ...work("crew"), tenant_id: "other" }, work("another-team")]);
    assert.equal(await calendarHasWork(client, T, "crew"), false);
  });

  test("сбой чтения — ошибка, а не «работы нет»", async () => {
    const client = fakeClient([event("crew")], "finance_transactions");
    await assert.rejects(() => calendarHasWork(client, T, "crew"), /finance_transactions denied/);
  });

  test("в счёт идут только живые календари с работой", () => {
    assert.equal(paidCalendarCount(["a", "b", "c"], new Set(["a", "c", "archived"])), 2);
    assert.equal(paidCalendarCount(["a"], new Set()), 0);
  });
});

describe("правило приложения = функция базы", () => {
  test("миграция paid_calendar_count лежит в репозитории", () => {
    assert.ok(migrationFile, "нет файла *_paid_calendar_count.sql");
  });

  test("функция базы считает живые календари с теми же источниками работы", () => {
    assert.match(SQL, /from public\.teams t\s+where t\.tenant_id = p_tenant\s+and t\.is_active/);
    const tables = [...SQL.matchAll(/select 1 from public\.(\w+) \w+/g)].map((m) => m[1]);
    assert.deepEqual(
      tables,
      CALENDAR_WORK_SOURCES.map((s) => s.table),
      "источники работы в SQL и в приложении разошлись",
    );
    for (const source of CALENDAR_WORK_SOURCES) {
      const block = SQL.slice(SQL.indexOf(`from public.${source.table}`)).split(")")[0] ?? "";
      assert.match(block, /team_id = t\.id and \w+\.tenant_id = p_tenant/, `${source.table}: не по календарю и аккаунту`);
      if ("kind" in source) assert.match(block, new RegExp(`kind = '${source.kind}'`), `${source.table}: нет kind`);
      else assert.doesNotMatch(block, /kind =/, `${source.table}: лишний фильтр kind`);
    }
  });

  test("функция базы — только служебному ключу", () => {
    assert.match(SQL, /security definer/);
    assert.match(SQL, /revoke all on function public\.paid_calendar_count\(uuid\) from public, anon, authenticated;/);
    assert.match(SQL, /grant execute on function public\.paid_calendar_count\(uuid\) to service_role;/);
  });

  test("tariff-checkout и сверка вебхука считают функцией базы, а не все живые", () => {
    assert.match(HELPER, /service\.rpc\("paid_calendar_count", \{ p_tenant: tenantId \}\)/);
    assert.match(HELPER, /if \(error \|\| typeof data !== "number"\) \{\s*throw new Error/);
    assert.match(HELPER, /return Math\.max\(1, data\);/);
    assert.match(FN, /const liveNow = await paidCalendars\(service, tenantId\);/);
    assert.match(WEBHOOK, /const live = await paidCalendars\(sbs, tenantId\);/);
    for (const [name, src] of [["tariff-checkout", FN], ["stripe-webhook", WEBHOOK]] as const) {
      assert.doesNotMatch(src, /\.from\("teams"\)\s*\.select\("id", \{ count: "exact"/, `${name}: остался подсчёт всех живых`);
    }
  });

  test("страница «Тариф» и «Новый календарь» берут то же число, а не все календари", () => {
    const screen = read("apps/mobile/src/features/tariffs/TariffScreen.tsx");
    const sheets = read("apps/mobile/src/features/calendar/settings-screen/CalendarSettingsSheets.tsx");
    const hook = read("apps/mobile/src/features/tariffs/use-live-calendars.ts");
    assert.match(screen, /const calendars = Math\.max\(1, liveCount \?\? 0\);/);
    assert.match(sheets, /calendars=\{paidCalendars \?\? 0\}/);
    assert.doesNotMatch(sheets, /calendars=\{teams\.length\}/);
    assert.match(hook, /calendarHasWork\(work, tenantId, teamId\)/);
  });
});
