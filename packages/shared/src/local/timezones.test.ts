import { describe, expect, test } from "bun:test";
import { ZONE_GROUPS, TIMEZONE_OPTIONS } from "./timezones";

// СПИСОК ПОЯСОВ РЕШАЕТ, КОГДА У БИЗНЕСА КОНЧАЕТСЯ ДЕНЬ.
//
// Он сгенерирован из ICU, а значит может молча разъехаться при обновлении
// данных о переводе часов. Эти проверки ловят ровно то, что дорого стоит:
// невалидную зону (экран падает) и две группы с ОДИНАКОВЫМ поведением —
// признак, что группировка развалилась и человек выбирает из дублей.

function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour") % 24,
    g("minute"),
  );
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** Отпечаток поведения зоны за год — двенадцать проб, по одной на месяц. */
const signature = (zone: string) =>
  Array.from({ length: 12 }, (_, m) =>
    offsetMinutes(zone, new Date(Date.UTC(2026, m, 15, 12))),
  ).join(",");

describe("группы часовых поясов", () => {
  test("список не пуст и обозрим — барабан, а не простыня", () => {
    expect(ZONE_GROUPS.length).toBeGreaterThan(30);
    expect(ZONE_GROUPS.length).toBeLessThan(80);
  });

  test("каждая зона валидна для Intl", () => {
    for (const g of ZONE_GROUPS) {
      expect(() =>
        new Intl.DateTimeFormat("en-US", { timeZone: g.zone }).format(new Date()),
      ).not.toThrow();
    }
  });

  test("представитель группы назван среди её городов", () => {
    for (const g of ZONE_GROUPS) {
      const city = g.zone.split("/").pop()!.replace(/_/g, " ");
      expect(g.cities).toContain(city);
    }
  });

  test("ГЛАВНОЕ: две группы никогда не ведут себя одинаково круглый год", () => {
    // Иначе это дубль: человеку предложены две строки, между которыми нет
    // никакой разницы ни в один день года.
    const seen = new Map<string, string>();
    for (const g of ZONE_GROUPS) {
      const sig = signature(g.zone);
      expect(seen.has(sig)).toBe(false);
      seen.set(sig, g.zone);
    }
  });

  test("группы идут с запада на восток", () => {
    const jan = new Date(Date.UTC(2026, 0, 15, 12));
    const offs = ZONE_GROUPS.map((g) => offsetMinutes(g.zone, jan));
    expect([...offs].sort((a, b) => a - b)).toEqual(offs);
  });

  test("плоский список зон совпадает с представителями групп", () => {
    expect(TIMEZONE_OPTIONS).toEqual(ZONE_GROUPS.map((g) => g.zone));
  });
});
