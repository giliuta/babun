import { describe, expect, test } from "bun:test";
import type { Appointment } from "../../local/appointments";
import { expandRepeat } from "./expand-repeat";

// Минимальный seed: движку важны только date/status/event_repeat/id.
function seed(over: Partial<Appointment>): Appointment {
  return {
    id: "seed-1",
    date: "2025-07-01",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    kind: "event",
    ...over,
  } as Appointment;
}

describe("expandRepeat — бесконечные серии не умирают от возраста", () => {
  // Регрессия 2026-07-27: countLimit по умолчанию был 365 «вхождений от
  // seed», и ежедневное событие старше года молча исчезало из календаря
  // (а его напоминания гасились нулевым разворотом от «сегодня»).
  test("ежедневная серия старше года видна в текущем окне", () => {
    const s = seed({ event_repeat: { kind: "daily" } });
    const out = expandRepeat(s, "2026-08-01", "2026-08-07");
    expect(out.map((o) => o.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  test("будни старше 17 месяцев видны в текущем окне", () => {
    const s = seed({ date: "2025-01-06", event_repeat: { kind: "weekdays" } });
    const out = expandRepeat(s, "2026-07-27", "2026-07-31");
    // Пн 27 — Пт 31 июля 2026: пять будних дней.
    expect(out).toHaveLength(5);
  });

  test("count остаётся «N вхождений от seed»: окно после N-го пусто", () => {
    const s = seed({ event_repeat: { kind: "daily", count: 10 } });
    // 10 вхождений: 1–10 июля 2025. Позже — ничего.
    expect(expandRepeat(s, "2025-07-08", "2025-07-20").map((o) => o.date)).toEqual([
      "2025-07-08",
      "2025-07-09",
      "2025-07-10",
    ]);
    expect(expandRepeat(s, "2026-07-01", "2026-07-31")).toHaveLength(0);
  });

  test("until обрывает серию", () => {
    const s = seed({
      event_repeat: { kind: "daily", until: "2025-07-05" },
    });
    expect(expandRepeat(s, "2025-07-01", "2025-07-31")).toHaveLength(5);
    expect(expandRepeat(s, "2026-07-01", "2026-07-31")).toHaveLength(0);
  });

  test("окно шире 365 вхождений капится MAX_OCCURRENCES, а не пустеет", () => {
    const s = seed({ event_repeat: { kind: "daily" } });
    const out = expandRepeat(s, "2025-07-01", "2027-07-01");
    expect(out).toHaveLength(365);
    // И это именно ПЕРВЫЕ 365 дней окна, начиная с seed.
    expect(out[0].date).toBe("2025-07-01");
  });

  test("виртуалы несут virtualParentId, seed — сам себя", () => {
    const s = seed({ event_repeat: { kind: "weekly" } });
    const out = expandRepeat(s, "2025-07-01", "2025-07-15");
    expect(out[0]).toBe(s);
    expect(
      (out[1] as Appointment & { virtualParentId?: string }).virtualParentId,
    ).toBe("seed-1");
    expect(out[1].id).toBe("seed-1@2025-07-08");
  });
});
