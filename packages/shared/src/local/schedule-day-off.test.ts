import { describe, expect, test } from "bun:test";
import { isDayOff, setDayOff, type TeamSchedule } from "./schedule";

// «ВЫХОДНОЙ» В ШТОРКЕ МЕТКИ — ПО ВСЕМУ ГРАФИКУ (повторный аудит 03.10).
// 2026-10-04 — воскресенье, 2026-10-05 — понедельник.
const base: TeamSchedule = {
  start: "09:00",
  end: "18:00",
  breaks: [],
  overrides: { sun: { is_working: false, start: "00:00", end: "00:00", breaks: [] } },
};

describe("выходной на дату", () => {
  test("воскресенье, выходное по неделе, — выходной", () => {
    expect(isDayOff(base, "2026-10-04")).toBe(true);
    expect(isDayOff(base, "2026-10-05")).toBe(false);
  });

  test("отпуск — выходной", () => {
    expect(isDayOff({ ...base, vacations: [{ start: "2026-10-05", end: "2026-10-09" }] }, "2026-10-07")).toBe(true);
  });

  test("графика нет — рабочий", () => {
    expect(isDayOff(null, "2026-10-04")).toBe(false);
  });

  test("снять выходной с недельного воскресенья — рабочее по общим часам", () => {
    const next = setDayOff(base, "2026-10-04", false);
    expect(isDayOff(next, "2026-10-04")).toBe(false);
    expect(next.date_overrides?.["2026-10-04"]).toEqual({ is_working: true, start: "09:00", end: "18:00", breaks: [] });
    // Недельный график цел: следующее воскресенье — по-прежнему выходной.
    expect(isDayOff(next, "2026-10-11")).toBe(true);
  });

  test("снять выходной, поставленный на дату, — правка уходит целиком", () => {
    const off = setDayOff(base, "2026-10-05", true);
    expect(isDayOff(off, "2026-10-05")).toBe(true);
    const back = setDayOff(off, "2026-10-05", false);
    expect(back.date_overrides?.["2026-10-05"]).toBeUndefined();
    expect(isDayOff(back, "2026-10-05")).toBe(false);
  });

  test("круг: рабочее воскресенье снова выходное — правка снята, а не удвоена", () => {
    const working = setDayOff(base, "2026-10-04", false);
    const offAgain = setDayOff(working, "2026-10-04", true);
    expect(isDayOff(offAgain, "2026-10-04")).toBe(true);
    expect(offAgain.date_overrides?.["2026-10-04"]).toBeUndefined();
  });

  test("выходной на рабочий день — правка с часами дня", () => {
    const off = setDayOff(base, "2026-10-05", true);
    expect(off.date_overrides?.["2026-10-05"]).toEqual({ is_working: false, start: "09:00", end: "18:00", breaks: [] });
  });
});
