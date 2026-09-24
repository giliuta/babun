import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { Appointment } from "@babun/shared/local/appointments";
import {
  EVENT_FIELDS,
  WORK_CREATE_FIELDS,
  WORK_FIELD_BLOCK,
  changedFields,
  fieldBlock,
  memberCreateRow,
  memberPatch,
  memberWriteRefusal,
} from "./member-writes";

const MIGRATION = join(
  __dirname,
  "../../../../../supabase/migrations/20260924150000_calendar_and_record_blocks_live.sql",
);

/** Тело `member_check_appointment_field` из файла миграции — истина сервера. */
function serverFieldCheck(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("create or replace function public.member_check_appointment_field");
  const end = sql.indexOf("$function$;", start);
  assert.ok(start > 0 && end > start, "функция проверки поля есть в миграции");
  return sql.slice(start, end);
}

describe("запись сотрудника — зеркало серверной карты", () => {
  test("каждое поле рабочей записи ведёт в тот же блок, что на сервере", () => {
    const body = serverFieldCheck();
    const server: Record<string, string> = {};
    const arms = /when p_key (?:in \(([^)]*)\)|= ('[a-z_]+')) then '([a-z_.]+)'/g;
    for (const arm of body.matchAll(arms)) {
      const keys = arm[1] ?? arm[2] ?? "";
      for (const key of keys.match(/'([a-z_]+)'/g) ?? []) server[key.slice(1, -1)] = arm[3];
    }
    assert.deepEqual(server, { ...WORK_FIELD_BLOCK });
  });

  test("поля события — те же, что пускает сервер", () => {
    const body = serverFieldCheck();
    const list = /if p_key not in \(([^)]*)\)/.exec(body)?.[1] ?? "";
    const server = new Set((list.match(/'([a-z_]+)'/g) ?? []).map((k) => k.slice(1, -1)));
    assert.deepEqual([...server].sort(), [...EVENT_FIELDS].sort());
  });

  test("статус: отмена и возврат из неё — «Отменять», остальное — «Статус»", () => {
    assert.equal(fieldBlock("status", "work", "cancelled", "scheduled"), "calendar.cancel");
    assert.equal(fieldBlock("status", "work", "scheduled", "cancelled"), "calendar.cancel");
    assert.equal(fieldBlock("status", "work", "completed", "in_progress"), "record.status");
    assert.equal(fieldBlock("paid_amount", "work"), null, "деньги сотрудник так не меняет");
    assert.equal(fieldBlock("client_id", "event"), null, "у события клиента нет");
    assert.equal(fieldBlock("event_notes", "event"), "calendar.events");
  });

  test("патч: без undefined; незнакомое поле не выбрасывается молча", () => {
    const { body, foreign } = memberPatch(
      { date: "2026-09-26", comment: undefined, payment_status: "paid", client_id: null },
      "work",
    );
    assert.deepEqual(body, { date: "2026-09-26", client_id: null });
    assert.deepEqual(foreign, ["payment_status"]);
  });

  test("создание: пустое не отправляется — «без клиента» не требует права на клиента", () => {
    const row = memberCreateRow({
      id: "id-1",
      kind: "work",
      team_id: "team-1",
      date: "2026-09-27",
      time_start: "10:00",
      time_end: "11:30",
      total_duration: 90,
      status: "scheduled",
      client_id: null,
      location_id: null,
      services: [],
      service_ids: [],
      total_amount: 0,
      custom_total: false,
      discount_amount: 0,
      service_price_overrides: {},
      color_override: null,
      city: null,
      comment: "Взять лестницу",
      payment_status: "unpaid",
    } as unknown as Appointment);
    assert.deepEqual(row, {
      id: "id-1",
      kind: "work",
      team_id: "team-1",
      date: "2026-09-27",
      time_start: "10:00",
      time_end: "11:30",
      total_duration: 90,
      comment: "Взять лестницу",
    });
  });

  test("отказ сервера — словами, с названием блока", () => {
    const titles: Record<string, string> = { "calendar.move": "Переносить записи" };
    const titleOf = (key: string) => titles[key];
    assert.equal(
      memberWriteRefusal("updateAppointment: access:block:calendar.move", titleOf),
      "Нет права «Переносить записи» в этом календаре",
    );
    assert.equal(memberWriteRefusal("access:field:paid_amount", titleOf), "Это поле меняет только владелец");
    assert.equal(memberWriteRefusal("access:client", titleOf), "Этот клиент вам недоступен");
    assert.equal(memberWriteRefusal("boom", titleOf), null);
  });

  test("правка несёт только изменённое — нетронутый клиент права не требует", () => {
    const before = { client_id: "c-1", date: "2026-09-25", services: [{ id: "s" }], comment: "" };
    const after = { client_id: "c-1", date: "2026-09-26", services: [{ id: "s" }], comment: "" };
    assert.deepEqual(changedFields(before as never, after as never), { date: "2026-09-26" });
    assert.deepEqual(changedFields(before as never, before as never), {});
  });

  test("поля новой записи — те же, что пускает дверь создания", () => {
    const sql = readFileSync(
      join(__dirname, "../../../../../supabase/migrations/20260924170000_member_create_is_authorship.sql"),
      "utf8",
    );
    const list = /if k not in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const server = (list.match(/'([a-z_]+)'/g) ?? []).map((k) => k.slice(1, -1)).sort();
    assert.ok(server.length > 10, "список полей найден в миграции");
    assert.deepEqual(server, [...WORK_CREATE_FIELDS].sort());
  });
});
