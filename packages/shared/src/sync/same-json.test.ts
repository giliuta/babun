import { describe, expect, test } from "bun:test";
import { sameJson } from "./same-json";

const viaJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe("sameJson — как сравнение через JSON, без строк", () => {
  test("совпадает с JSON на строках кэша", () => {
    const row = {
      id: "a1",
      date: "2026-10-13",
      total_amount: 120,
      services: [{ id: "s", qty: 1, price: 60 }],
      event_repeat: { kind: "weekly", until: undefined },
      note: null,
      ok: true,
    };
    const same = JSON.parse(JSON.stringify(row));
    const cases: [unknown, unknown][] = [
      [row, same],
      [row, { ...same, total_amount: 121 }],
      [row, { ...same, services: [{ id: "s", qty: 2, price: 60 }] }],
      [row, { ...same, extra: 1 }],
      [{ a: undefined }, {}],
      [{ a: null }, {}],
      [[1, undefined], [1, null]],
      [[1, 2], [2, 1]],
      ["1", 1],
      [0, false],
      [{ a: [] }, { a: {} }],
    ];
    for (const [a, b] of cases) expect(sameJson(a, b)).toBe(viaJson(a, b));
  });

  test("порядок ключей не важен (раньше — лишняя перезапись)", () => {
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});
