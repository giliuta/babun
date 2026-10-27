import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { deriveOpenHour, deriveWindow } from "./window";

// Окно рельса раздвигается под записи: запись, выпавшая из окна, не должна
// молча пропадать с сетки, оставаясь в «Списке».

function apt(timeStart: string, timeEnd: string, date = "2026-10-28"): Appointment {
  return { id: "a1", date, time_start: timeStart, time_end: timeEnd } as Appointment;
}

const FALLBACK = { start: 8, end: 20 };
const EXPLICIT = { start: 8, end: 20 };

describe("окно рельса — записи на кромке", () => {
  test("событие нулевой длительности на конце окна — окно на час дальше", () => {
    const w = deriveWindow([], FALLBACK, [apt("20:00", "20:00")], EXPLICIT);
    assert.equal(w.endHour, 21);
  });

  test("запись «23:00–00:00» помещается целиком до конца суток", () => {
    const w = deriveWindow([], FALLBACK, [apt("23:00", "00:00")], EXPLICIT);
    assert.equal(w.endHour, 24);
  });

  test("обычная запись внутри окна его не трогает", () => {
    const w = deriveWindow([], FALLBACK, [apt("10:00", "11:00")], EXPLICIT);
    assert.deepEqual(w, { startHour: 8, endHour: 20 });
  });
});

// Календарь открывается на деле, а не на ночи: сегодня — «сейчас» с часом
// запаса, другой день — начало работы или первая запись.
describe("час открытия сетки", () => {
  const TODAY = "2026-10-27";
  const OTHER = "2026-10-28";
  const FULL_DAY = { startHour: 0, endHour: 24 };
  const NO_HOURS = { start: 0, end: 24 };
  const open = (o: Partial<Parameters<typeof deriveOpenHour>[0]>) =>
    deriveOpenHour({
      days: [TODAY],
      todayYmd: TODAY,
      nowMinutes: 14 * 60 + 37,
      fallback: NO_HOURS,
      appts: [],
      window: FULL_DAY,
      ...o,
    });

  test("сегодня — на час выше «сейчас», по получасам", () => {
    assert.equal(open({}), 13.5);
  });

  test("неделя с сегодняшним днём — тоже «сейчас»", () => {
    assert.equal(open({ days: [OTHER, TODAY] }), 13.5);
  });

  test("ранним утром «сейчас» не уходит выше окна", () => {
    assert.equal(open({ nowMinutes: 20, window: { startHour: 6, endHour: 22 } }), 6);
  });

  test("другой день — начало рабочего окна команды", () => {
    const band = { startMin: 9 * 60, endMin: 18 * 60 };
    assert.equal(open({ days: [OTHER], bandFor: () => band }), 9);
  });

  test("запись раньше работы — открывается на ней", () => {
    const band = { startMin: 9 * 60, endMin: 18 * 60 };
    assert.equal(
      open({ days: [OTHER], bandFor: () => band, appts: [apt("07:30", "08:30", OTHER)] }),
      7,
    );
  });

  test("без рабочих часов — первая запись дня", () => {
    assert.equal(open({ days: [OTHER], appts: [apt("11:00", "12:00", OTHER)] }), 11);
  });

  test("записи других дней не считаются", () => {
    assert.equal(open({ days: [OTHER], appts: [apt("03:00", "04:00", TODAY)] }), 8);
  });

  test("ни часов, ни записей — утро, а не полночь", () => {
    assert.equal(open({ days: [OTHER] }), 8);
  });

  test("общие рабочие часы — когда графика команды нет", () => {
    assert.equal(open({ days: [OTHER], fallback: { start: 10, end: 19 } }), 10);
  });

  test("выходной по графику не берёт общие часы", () => {
    assert.equal(
      open({ days: [OTHER], bandFor: () => null, fallback: { start: 10, end: 19 } }),
      8,
    );
  });
});
