import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { Appointment } from "@babun/shared/local/appointments";
import {
  EVENT_FIELDS,
  EVENT_FIELD_BLOCK,
  WORK_CREATE_FIELDS,
  WORK_FIELD_BLOCK,
  changedFields,
  fieldBlock,
  memberCreateRow,
  memberPatch,
  memberWriteRefusal,
  isOwnRecordAlreadyCreated,
} from "./member-writes";

const MIGRATIONS = join(__dirname, "../../../../../supabase/migrations");
const DEFINER = /create or replace function public\.member_check_appointment_field/i;

/** Тело `member_check_appointment_field` из ПОСЛЕДНЕЙ миграции, которая её
 *  определяет, — истина сервера. Прежде тест держал файл 24.09 и не увидел,
 *  что 30.09 событие получило клиента и объект, а заметка записи — своё право
 *  (сторож, который не мог упасть; аудит формы записи 03.10). */
function serverFieldCheck(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => DEFINER.test(readFileSync(join(MIGRATIONS, name), "utf8")));
  const latest = files.at(-1);
  assert.ok(latest, "функция проверки поля есть в миграциях");
  const sql = readFileSync(join(MIGRATIONS, latest), "utf8");
  const start = sql.search(DEFINER);
  const end = sql.indexOf("$function$", sql.indexOf("$function$", start) + 1);
  assert.ok(start >= 0 && end > start, `тело функции в ${latest}`);
  return sql.slice(start, end);
}

/** Ветки `case … then '<блок>'` в куске тела → поле → блок. */
function caseArms(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  const arms = /when p_key (?:in \(([^)]*)\)|= ('[a-z_]+')) then '([a-z_.]+)'/g;
  for (const arm of body.matchAll(arms)) {
    const keys = arm[1] ?? arm[2] ?? "";
    for (const key of keys.match(/'([a-z_]+)'/g) ?? []) map[key.slice(1, -1)] = arm[3];
  }
  return map;
}

/** Тело делится на ветку события (до первого `end if;` после `return;`) и
 *  ветку рабочей записи. */
function branches(): { event: string; work: string } {
  const body = serverFieldCheck();
  const split = body.indexOf("v_block := case", body.indexOf("v_block := case") + 1);
  assert.ok(split > 0, "у функции две ветки: событие и запись");
  return { event: body.slice(0, split), work: body.slice(split) };
}

describe("запись сотрудника — зеркало серверной карты", () => {
  test("каждое поле рабочей записи ведёт в тот же блок, что на сервере", () => {
    assert.deepEqual(caseArms(branches().work), { ...WORK_FIELD_BLOCK });
  });

  test("поля события и их блоки — те же, что у сервера", () => {
    const { event } = branches();
    const server = caseArms(event);
    const together = /if p_key in \(([^)]*)\) then\s*return;/.exec(event)?.[1] ?? "";
    for (const key of together.match(/'([a-z_]+)'/g) ?? []) server[key.slice(1, -1)] = "calendar.events";
    assert.deepEqual(server, { ...EVENT_FIELD_BLOCK });
    assert.deepEqual([...EVENT_FIELDS].sort(), Object.keys(server).sort());
  });

  test("статус: отмена и возврат из неё — «Отменять», иного статуса нет (03.10)", () => {
    assert.equal(fieldBlock("status", "work", "cancelled", "scheduled"), "calendar.cancel");
    assert.equal(fieldBlock("status", "work", "scheduled", "cancelled"), "calendar.cancel");
    assert.equal(fieldBlock("status", "work", "completed", "in_progress"), null, "своего права у статуса больше нет");
    assert.equal(fieldBlock("paid_amount", "work"), null, "деньги сотрудник так не меняет");
    assert.equal(fieldBlock("client_id", "event"), "event.client");
    assert.equal(fieldBlock("location_id", "event"), "event.object");
    assert.equal(fieldBlock("event_notes", "event"), "event.note");
    assert.equal(fieldBlock("paid_amount", "event"), null);
  });

  test("повтор «Создать» после оборванного ответа — та же запись, а не ошибка", () => {
    assert.equal(
      isOwnRecordAlreadyCreated({
        code: "23505",
        message: 'duplicate key value violates unique constraint "appointments_pkey"',
      }),
      true,
    );
    // Другой уникальный ключ — настоящий отказ.
    assert.equal(
      isOwnRecordAlreadyCreated({ code: "23505", message: 'violates unique constraint "x_slot_key"' }),
      false,
    );
    assert.equal(isOwnRecordAlreadyCreated({ code: "42501", message: "access:block:calendar.create" }), false);
    assert.equal(isOwnRecordAlreadyCreated(null), false);
    // Путь владельца: `Error` без кода, текст базы за префиксом обёртки
    // (03.10 — второе «Создать» после перезапуска базы показывало его как есть).
    assert.equal(
      isOwnRecordAlreadyCreated(
        new Error('createAppointment: duplicate key value violates unique constraint "appointments_pkey"'),
      ),
      true,
    );
    assert.equal(
      isOwnRecordAlreadyCreated(new Error('createAppointment: duplicate key value violates unique constraint "x_slot_key"')),
      false,
    );
  });

  test("длительность из услуг без переноса не требует «Переносить»", () => {
    const quantity = memberPatch({ services: [], total_amount: 80, total_duration: 120 }, "work");
    assert.deepEqual(quantity.body, { services: [], total_amount: 80 });
    const moved = memberPatch({ time_end: "12:00", total_duration: 120 }, "work");
    assert.deepEqual(moved.body, { time_end: "12:00", total_duration: 120 });
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
    // Запись сотрудника не уходит из своей команды (владелец 30.09).
    assert.equal(
      memberWriteRefusal("updateAppointment: access:team_move", titleOf),
      "Запись остаётся в своей команде",
    );
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
