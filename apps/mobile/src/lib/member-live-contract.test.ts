// ЖИВОЕ ОБНОВЛЕНИЕ У СОТРУДНИКА. Таблица записей ему закрыта, поэтому
// `postgres_changes` владельца ему ничего не отдаёт. Сторожим три звена:
// сервер шлёт в `calendar:<команда>` только номер записи (никаких данных мимо
// масок двери), приложение монтирует мастеру его мост, а мост перечитывает
// записи и по сигналу, и по возврату из фона.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "../..");
const SIGNAL_FILE = "20261027160000_calendar_change_signal.sql";

function source(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), "utf8");
}

/** Черновик до наката лежит в `parked/`, после — в `migrations/`. */
function signalMigration(): string {
  for (const dir of ["supabase/migrations", "supabase/parked"]) {
    const file = path.join(REPO_ROOT, dir, SIGNAL_FILE);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`${SIGNAL_FILE} not found`);
}

describe("member live calendar", () => {
  test("server signal carries only id, updated_at and op", () => {
    const sql = signalMigration();
    const payloads = [...sql.matchAll(/jsonb_build_object\(([^;]*?)\);/g)].map((m) => m[1]);
    assert.equal(payloads.length, 1, "one payload builder");
    const keys = [...payloads[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(keys, ["id", "op", "updated_at"]);
    assert.match(sql, /realtime\.send\(payload, 'appointment_changed', 'calendar:' \|\| new_team, true\)/);
    assert.match(sql, /realtime\.send\(payload, 'appointment_changed', 'calendar:' \|\| old_team, true\)/);
  });

  test("only people with records or events of that calendar may listen", () => {
    const sql = signalMigration();
    assert.match(sql, /access_calendars_of\(team_tenant, caller, 'calendar\.records', 'read'\)/);
    assert.match(sql, /access_calendars_of\(team_tenant, caller, 'calendar\.events', 'read'\)/);
    assert.match(sql, /revoke all on function public\.can_watch_calendar\(text\) from public, anon;/);
    assert.match(sql, /on realtime\.messages\s+for select\s+to authenticated/);
    assert.match(sql, /public\.can_watch_calendar\(\(select realtime\.topic\(\)\)\)/);
  });

  test("the master gets his own bridge, fed by his calendars", () => {
    const providers = source("src/providers/AppProviders.tsx");
    assert.match(providers, /role === "master" \? <MemberSyncBridgeMount \/> : null/);
    assert.match(providers, /useMyAccess\(\)\.data\?\.attachedCalendars/);
    assert.match(providers, /startMemberSyncBridge\(watched\.split\(","\)\)/);
  });

  test("the bridge re-reads on a signal, after a drop and on return from background", () => {
    const bridge = source("src/lib/sync-bridge.ts");
    const body = bridge.slice(bridge.indexOf("export function startMemberSyncBridge"));
    assert.match(body, /startCalendarSignals\(/);
    assert.match(body, /onResync: \(\) => invalidate\(qc, "appointments"\)/);
    assert.match(body, /AppState\.addEventListener\("change"/);
    assert.match(body, /isReturnToForeground\(appState, next\)\) invalidate\(qc, "appointments"\)/);
    assert.match(body, /foreground\.remove\(\)/);
    assert.match(body, /stopSignals\(\)/);
  });
});
