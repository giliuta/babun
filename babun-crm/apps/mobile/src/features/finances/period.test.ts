import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultPeriod,
  makePeriod,
  monthPeriodOf,
  periodDates,
  periodPhrase,
  presetHint,
  presetRange,
} from "./period";

// period.ts — граница ВСЕХ денежных запросов: from/to отсюда уходят в итоги
// счетов, ленты операций, панель НДС и экспорт. Ошибка на стыке года — это
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

describe("makePeriod / monthPeriodOf", () => {
  test("makePeriod сохраняет имя пресета рядом с границами", () => {
    assert.deepEqual(makePeriod("lastmonth", JAN15), {
      preset: "lastmonth",
      from: "2025-12-01",
      to: "2025-12-31",
    });
    assert.equal(defaultPeriod(JAN15).preset, "month");
  });

  test("monthPeriodOf — месяц даты, пресет намеренно custom", () => {
    assert.deepEqual(monthPeriodOf("2026-07-15"), {
      preset: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });
});

describe("periodPhrase — период словами", () => {
  const custom = (from: string, to: string) =>
    ({ preset: "custom", from, to }) as const;

  test("целый год и целый месяц называются именем", () => {
    assert.equal(periodPhrase(custom("2026-01-01", "2026-12-31"), JAN15), "2026 год");
    assert.equal(
      periodPhrase(custom("2026-01-01", "2026-01-31"), JAN15),
      "январь",
    );
  });

  test("целый месяц ЧУЖОГО года обязан назвать год", () => {
    assert.equal(
      periodPhrase(custom("2025-08-01", "2025-08-31"), JAN15),
      "август 2025",
    );
  });

  test("день и диапазон внутри месяца — родительный падеж", () => {
    assert.equal(periodPhrase(custom("2026-08-10", "2026-08-10"), JAN15), "10 августа");
    assert.equal(
      periodPhrase(custom("2026-08-01", "2026-08-15"), JAN15),
      "1–15 августа",
    );
  });

  test("диапазон через месяцы одного года — без года", () => {
    assert.equal(
      periodPhrase(custom("2026-06-15", "2026-07-10"), JAN15),
      "15 июня – 10 июля",
    );
  });

  test("диапазон через границу года несёт год у ОБЕИХ границ", () => {
    // Двухлетний и двухмесячный периоды обязаны читаться по-разному —
    // именно их «15 декабря – 10 января 2026» не различала.
    assert.equal(
      periodPhrase(custom("2024-12-15", "2026-01-10"), JAN15),
      "15 декабря 2024 – 10 января 2026",
    );
    assert.equal(
      periodPhrase(custom("2025-12-15", "2026-01-10"), JAN15),
      "15 декабря 2025 – 10 января 2026",
    );
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
