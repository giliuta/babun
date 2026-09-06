import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { freeSlotsForDay } from "./free-slots";

// Ядро «зелёных кубиков»: ошибка здесь предложит диспетчеру занятое время —
// он пообещает клиенту час, которого нет.

const BAND = { startMin: 9 * 60, endMin: 12 * 60 };
const FALLBACK = { startMin: 8 * 60, endMin: 20 * 60 };

function apt(over: Partial<Appointment>): Appointment {
  return {
    id: over.id ?? "a1",
    date: "2026-08-10",
    time_start: "10:00",
    time_end: "11:00",
    status: "planned",
    kind: "work",
    ...over,
  } as Appointment;
}

const base = {
  band: BAND,
  fallback: FALLBACK,
  stepMinutes: 30,
  bufferMinutes: 0,
  nowMinutes: null,
};

describe("free slots", () => {
  test("пустой день режется шагом внутри рабочей полосы", () => {
    const slots = freeSlotsForDay({ ...base, appts: [] });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"],
    );
  });

  test("выходной команды не предлагает ничего", () => {
    assert.deepEqual(freeSlotsForDay({ ...base, band: null, appts: [] }), []);
  });

  test("без графика команды берутся общие часы", () => {
    const slots = freeSlotsForDay({
      ...base,
      band: undefined,
      stepMinutes: 60,
      appts: [],
    });
    assert.equal(slots[0]?.time, "08:00");
    assert.equal(slots.at(-1)?.time, "19:00");
  });

  test("занятое время не зеленеет", () => {
    const slots = freeSlotsForDay({ ...base, appts: [apt({})] });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00", "09:30", "11:00", "11:30"],
    );
  });

  test("буфер на дорогу съедает соседние слоты", () => {
    const slots = freeSlotsForDay({
      ...base,
      bufferMinutes: 30,
      appts: [apt({})],
    });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00", "11:30"],
    );
  });

  test("отменённая запись освобождает время", () => {
    const slots = freeSlotsForDay({
      ...base,
      appts: [apt({ status: "cancelled" })],
    });
    assert.equal(slots.length, 6);
  });

  test("перерыв команды вырезается", () => {
    const slots = freeSlotsForDay({
      ...base,
      band: { ...BAND, breaks: [{ startMin: 10 * 60, endMin: 11 * 60 }] },
      appts: [],
    });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00", "09:30", "11:00", "11:30"],
    );
  });

  test("событие «весь день» закрывает сутки", () => {
    const slots = freeSlotsForDay({
      ...base,
      appts: [apt({ kind: "event", event_all_day: true })],
    });
    assert.deepEqual(slots, []);
  });

  test("сегодня прошедшие часы не предлагаются", () => {
    const slots = freeSlotsForDay({
      ...base,
      appts: [],
      nowMinutes: 10 * 60 + 15,
    });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["10:30", "11:00", "11:30"],
    );
  });

  test("слот, не влезающий до конца смены, не предлагается", () => {
    const slots = freeSlotsForDay({
      ...base,
      band: { startMin: 9 * 60, endMin: 9 * 60 + 45 },
      appts: [],
    });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00"],
    );
  });
});

// Перенос: кубик обещает, что запись ВСЯ влезет — иначе диспетчер поставит
// полуторачасовой визит в получасовую щель перед чужой записью.
describe("free slots for a move", () => {
  test("окно длиннее шага: старт зелёный, только если влезает целиком", () => {
    // Полоса 9–12, чужая запись 10:00–11:00, окно 90 мин.
    const slots = freeSlotsForDay({
      ...base,
      durationMinutes: 90,
      appts: [apt({ id: "other" })],
    });
    // 09:00 упирается в 10:00 через 60 минут; 11:00 — конец 12:30 за сменой.
    assert.deepEqual(slots.map((s) => s.time), []);
  });

  test("окно упирается в перерыв — старт не предлагается", () => {
    const slots = freeSlotsForDay({
      ...base,
      durationMinutes: 60,
      band: { ...BAND, breaks: [{ startMin: 10 * 60, endMin: 10 * 60 + 30 }] },
      appts: [],
    });
    assert.deepEqual(
      slots.map((s) => s.time),
      ["09:00", "10:30", "11:00"],
    );
  });

  test("собственное время переносимой записи не занято", () => {
    const moving = apt({ id: "moving", time_start: "10:00", time_end: "11:00" });
    const withSelf = freeSlotsForDay({ ...base, appts: [moving] });
    assert.deepEqual(
      withSelf.map((s) => s.time),
      ["09:00", "09:30", "11:00", "11:30"],
    );
    const ignoring = freeSlotsForDay({
      ...base,
      appts: [moving],
      ignoreId: "moving",
    });
    assert.equal(ignoring.length, 6);
  });

  test("окно короче шага округляется до шага", () => {
    const slots = freeSlotsForDay({
      ...base,
      durationMinutes: 15,
      band: { startMin: 9 * 60, endMin: 9 * 60 + 20 },
      appts: [],
    });
    assert.deepEqual(slots, []);
  });
});
