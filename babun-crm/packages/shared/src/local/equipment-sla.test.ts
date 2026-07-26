import { describe, expect, test } from "bun:test";
import { serviceDueState } from "./equipment-sla";

describe("график обслуживания", () => {
  test("без дат графика НЕТ — «сегодня» базой больше не подставляется", () => {
    // Раньше база = todayKey(), то есть «обслужили сегодня»: план всегда
    // уезжал вперёд вместе с сегодняшним днём и не срабатывал никогда.
    expect(serviceDueState({ service_interval_months: 12 })).toBeNull();
  });

  test("без интервала графика нет", () => {
    expect(serviceDueState({ last_service_at: "2026-01-10" })).toBeNull();
  });

  test("база — самая поздняя из известных дат", () => {
    const due = serviceDueState({
      installed_at: "2020-01-01",
      last_service_at: "2026-01-10",
      service_interval_months: 12,
    });
    expect(due?.nextDate).toBe("2027-01-10");
  });

  test("мусор вместо даты не считается базой", () => {
    const due = serviceDueState({
      installed_at: "неизвестно",
      service_interval_months: 6,
    });
    expect(due).toBeNull();
  });
});
