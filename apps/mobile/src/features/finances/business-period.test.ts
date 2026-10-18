import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { makePeriod } from "@/lib/period";
import { rebasePeriod } from "./business-period";

// 00:30 первого ноября по часам компании — телефон в другом поясе ещё
// живёт 31 октября.
const nov1 = new Date(2026, 10, 1, 0, 30);

describe("rebasePeriod — полночь и приезд пояса", () => {
  test("пресет пересобирается от нового «сейчас»", () => {
    const oct = makePeriod("today", new Date(2026, 9, 31, 23, 59));
    assert.deepEqual(rebasePeriod(oct, nov1), makePeriod("today", nov1));
  });

  test("ручной «Свой период» не трогается", () => {
    const custom = { preset: "custom" as const, from: "2026-09-01", to: "2026-09-10" };
    assert.equal(rebasePeriod(custom, nov1), custom);
  });
});

describe("проводка: никто не строит пресет по часам телефона", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = (f: string) => readFileSync(resolve(here, f), "utf8");
  // Вызов `makePeriod(x)` без второго аргумента — это часы телефона.
  const deviceClock = /makePeriod\(\s*[^,()]+(\([^()]*\))?\s*\)/;

  test("фильтр клиентов", () => {
    assert.doesNotMatch(code("../clients/filter-pref.ts"), deviceClock);
  });

  test("период «Аналитики» и «Финансов» пересобирается одним хуком", () => {
    assert.match(code("analytics/use-analytics.ts"), /useBusinessPeriod\(/);
    assert.match(code("home/use-home-period.ts"), /useBusinessPeriod\(/);
  });
});
