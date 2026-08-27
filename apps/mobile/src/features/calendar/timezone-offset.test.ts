import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { offsetToZone, zoneToOffset } from "./timezone-offset";

// ЗНАК У `Etc/GMT` ПЕРЕВЁРНУТ — И ЭТО НЕ ОПЕЧАТКА.
//
// В базе IANA `Etc/GMT-3` означает UTC+3, а `Etc/GMT+3` — UTC−3. Инверсия
// досталась от POSIX и противоречит здравому смыслу настолько, что её
// «чинят» примерно все, кто видит впервые. Цена ошибки — сутки: касса за
// день закроется не тем днём, а запись уедет во вчера.
//
// Поэтому знак живёт в ОДНОМ месте (`offsetToZone`) и заперт этим тестом.

describe("часовой пояс: своё время", () => {
  test("положительное смещение даёт Etc/GMT с МИНУСОМ", () => {
    assert.equal(offsetToZone(3), "Etc/GMT-3");
    assert.equal(offsetToZone(14), "Etc/GMT-14");
  });

  test("отрицательное смещение даёт Etc/GMT с ПЛЮСОМ", () => {
    assert.equal(offsetToZone(-5), "Etc/GMT+5");
    assert.equal(offsetToZone(-12), "Etc/GMT+12");
  });

  test("ноль — это Etc/GMT без знака", () => {
    assert.equal(offsetToZone(0), "Etc/GMT");
    assert.equal(zoneToOffset("Etc/GMT"), 0);
  });

  test("туда и обратно совпадает на всём диапазоне", () => {
    for (let h = -12; h <= 14; h++) {
      assert.equal(zoneToOffset(offsetToZone(h)), h, `сломалось на ${h}`);
    }
  });

  test("за границами диапазона зажимается, а не рождает несуществующую зону", () => {
    // `Etc/GMT` существует только от −12 до +14. Шире — Intl бросит.
    assert.equal(offsetToZone(99), "Etc/GMT-14");
    assert.equal(offsetToZone(-99), "Etc/GMT+12");
  });

  test("городская зона не притворяется своим временем", () => {
    assert.equal(zoneToOffset("Europe/Nicosia"), null);
    assert.equal(zoneToOffset("America/New_York"), null);
  });

  test("Intl принимает то, что мы сохраняем — иначе падают финансы", () => {
    for (let h = -12; h <= 14; h++) {
      const zone = offsetToZone(h);
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat("ru-RU", { timeZone: zone }).format(new Date()),
        `Intl не принял ${zone}`,
      );
    }
  });

  test("смещение и правда сдвигает часы на столько, сколько обещает", () => {
    const at = new Date("2026-08-27T12:00:00Z");
    const hourIn = (zone: string) =>
      Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          hour: "2-digit",
          hour12: false,
        }).format(at),
      );
    // 12:00 UTC → 15:00 при UTC+3 и 07:00 при UTC−5.
    assert.equal(hourIn(offsetToZone(3)), 15);
    assert.equal(hourIn(offsetToZone(-5)), 7);
  });
});
