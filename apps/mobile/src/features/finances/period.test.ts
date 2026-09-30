import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultPeriod,
  makePeriod,
  periodDates,
  presetHint,
  presetRange,
} from "./period";

// period.ts — граница ВСЕХ денежных запросов: from/to отсюда уходят в ленты
// операций, итоги «Финансов» и панель НДС. Ошибка на стыке года — это
// деньги, посчитанные не за тот период, поэтому все стыки закреплены здесь
// с фиксированной base (никакого «сегодня» внутри тестов).

// Четверг 15 января 2026 — «обычный день» внутри года.
const JAN15 = new Date(2026, 0, 15);
// Четверг 1 января 2026 — все недельные/месячные стыки года разом.
const JAN1 = new Date(2026, 0, 1);

describe("presetRange — границы пресетов", () => {
  test("today/yesterday: вчера от 1 января живёт в прошлом году", () => {
    assert.deepEqual(presetRange("today", JAN1), {
      from: "2026-01-01",
      to: "2026-01-01",
    });
    assert.deepEqual(presetRange("yesterday", JAN1), {
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  test("week: неделя понедельничная и переживает стык года", () => {
    // 1 января 2026 — четверг: его неделя началась 29 декабря 2025.
    assert.deepEqual(presetRange("week", JAN1), {
      from: "2025-12-29",
      to: "2026-01-04",
    });
    // Воскресенье принадлежит УЖЕ НАЧАТОЙ неделе, а не открывает новую.
    const sunday = new Date(2026, 0, 4);
    assert.deepEqual(presetRange("week", sunday), {
      from: "2025-12-29",
      to: "2026-01-04",
    });
  });

  test("lastweek через стык года лежит целиком в декабре", () => {
    assert.deepEqual(presetRange("lastweek", JAN1), {
      from: "2025-12-22",
      to: "2025-12-28",
    });
  });

  test("lastmonth в январе — декабрь ПРОШЛОГО года", () => {
    assert.deepEqual(presetRange("lastmonth", JAN15), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("month: конец месяца считается, а не берётся 30-м числом", () => {
    assert.deepEqual(presetRange("month", JAN15), {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    // Февраль високосного года — 29 дней.
    assert.deepEqual(presetRange("month", new Date(2028, 1, 10)), {
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  test("year/lastyear — календарные годы целиком", () => {
    assert.deepEqual(presetRange("year", JAN15), {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    assert.deepEqual(presetRange("lastyear", JAN15), {
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  test("custom без диапазона падает в сегодня (веб-паритет)", () => {
    assert.deepEqual(presetRange("custom", JAN15), {
      from: "2026-01-15",
      to: "2026-01-15",
    });
  });
});

describe("makePeriod", () => {
  test("makePeriod сохраняет имя пресета рядом с границами", () => {
    assert.deepEqual(makePeriod("lastmonth", JAN15), {
      preset: "lastmonth",
      from: "2025-12-01",
      to: "2025-12-31",
    });
    assert.equal(defaultPeriod(JAN15).preset, "month");
  });
});

describe("presetHint / periodDates — подписи строк", () => {
  test("presetHint: день, месяц, год и неделя через стык года", () => {
    assert.equal(presetHint("today", JAN15), "15 янв");
    assert.equal(presetHint("month", JAN15), "1–31 янв");
    assert.equal(presetHint("year", JAN15), "2026");
    assert.equal(presetHint("week", JAN1), "29 дек – 4 янв");
  });

  test("periodDates: диапазон точными датами, один день — одной", () => {
    assert.equal(
      periodDates({ preset: "custom", from: "2026-06-01", to: "2026-06-30" }),
      "01.06.26 – 30.06.26",
    );
    assert.equal(
      periodDates({ preset: "custom", from: "2026-06-01", to: "2026-06-01" }),
      "01.06.26",
    );
  });
});

describe("квартал — для VAT", () => {
  test("текущий и прошлый квартал, в том числе через границу года", () => {
    const sep = new Date(2026, 8, 24);
    assert.deepEqual(presetRange("quarter", sep), { from: "2026-07-01", to: "2026-09-30" });
    assert.deepEqual(presetRange("lastquarter", sep), { from: "2026-04-01", to: "2026-06-30" });
    const feb = new Date(2026, 1, 10);
    assert.deepEqual(presetRange("quarter", feb), { from: "2026-01-01", to: "2026-03-31" });
    assert.deepEqual(presetRange("lastquarter", feb), { from: "2025-10-01", to: "2025-12-31" });
  });
});
