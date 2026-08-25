import { describe, expect, test } from "bun:test";
import type { Appointment } from "../appointments";
import { unclosedAppointments, unclosedTotal } from "./unclosed";

// Эта сумма — единственные деньги, не попадающие ни в одну цифру экрана
// «Финансы». Ошибка здесь либо прячет незакрытую работу, либо пугает
// владельца хвостом, которого нет.

const TODAY = "2026-08-09";

function apt(over: Partial<Appointment>): Appointment {
  return {
    id: "a1",
    date: "2026-08-01",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    kind: "work",
    total_amount: 100,
    ...over,
  } as Appointment;
}

describe("не закрыто", () => {
  test("прошедшая запланированная работа считается", () => {
    const rows = unclosedAppointments([apt({})], TODAY);
    expect(rows).toHaveLength(1);
    expect(unclosedTotal(rows)).toBe(100);
  });

  test("сегодняшняя и будущая ещё не хвост — день не кончился", () => {
    const rows = unclosedAppointments(
      [apt({ date: TODAY }), apt({ date: "2026-08-20" })],
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  test("выполненная и отменённая закрыты", () => {
    const rows = unclosedAppointments(
      [apt({ status: "completed" }), apt({ status: "cancelled" })],
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  test("события и личные дела закрывать нечем", () => {
    const rows = unclosedAppointments(
      [apt({ kind: "event" }), apt({ kind: "personal" })],
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  test("запись без kind — старая рабочая, считается", () => {
    const rows = unclosedAppointments([apt({ kind: undefined })], TODAY);
    expect(rows).toHaveLength(1);
  });

  test("сначала свежие: разбирают с последнего дня", () => {
    const rows = unclosedAppointments(
      [apt({ id: "стар", date: "2026-07-01" }), apt({ id: "нов", date: "2026-08-05" })],
      TODAY,
    );
    expect(rows.map((r) => r.id)).toEqual(["нов", "стар"]);
  });

  test("запись без суммы не ломает итог", () => {
    expect(unclosedTotal([apt({ total_amount: undefined })])).toBe(0);
  });
});
