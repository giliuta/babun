import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  BIRTHDAY_DAYS,
  LOYAL_VISITS,
  matchesSegment,
  NEW_DAYS,
  OUTREACH_SEGMENTS,
  SEGMENT_RULES,
  segmentEvidence,
  SEGMENT_BLOCKS,
  SEGMENT_OPTIONS,
  sortClients,
} from "./filter";

function client(patch: Partial<Client> = {}): Client {
  return {
    ...createBlankClient({ id: "c1", full_name: "Клиент" }),
    created_at: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

function stats(patch: Partial<ClientStats> = {}): ClientStats {
  return {
    visits: 0,
    totalSpent: 0,
    lastVisitDate: "",
    lastVisitDays: null,
    medianGapDays: null,
    serviceDue: 0,
    unclosedVisits: 0,
    nextApt: null,
    nextAptDays: null,
    debt: 0,
    expectedRevenue: 0,
    lastTeamId: null,
    ageDays: 0,
    birthdayInDays: null,
    ...patch,
  };
}

const TODAY = "2026-07-26";

describe("matchesSegment — денежные «дела»", () => {
  // Пересечь «Должники» × «Пора дозаписать» внутри фасета нельзя (там ИЛИ),
  // поэтому это отдельный ряд — главный денежный список.
  test("«Долг, не записан» = есть долг И нет будущей записи", () => {
    const s = stats({ debt: 100, visits: 1, lastVisitDate: "2026-05-01" });
    assert.equal(matchesSegment(client(), "debtNoUpcoming", s, TODAY), true);

    const booked = stats({
      debt: 100,
      visits: 1,
      nextApt: { date: "2026-08-01", time: "10:00" },
    });
    assert.equal(
      matchesSegment(client(), "debtNoUpcoming", booked, TODAY),
      false,
    );
    // ДОЛГ РОЖДАЕТСЯ ТОЛЬКО ИЗ ВИЗИТА (владелец 2026-08-07: «как может
    // образоваться долг и не быть записи?»). Минусовой `balance` — легаси-
    // колонка, которую продукт не считает и не даёт править: раньше она
    // печаталась как долг у человека без единой работы. Теперь не считается.
    assert.equal(
      matchesSegment(client({ balance: -50 }), "debtNoUpcoming", stats(), TODAY),
      false,
    );
    assert.equal(
      matchesSegment(client({ balance: -50 }), "debt", stats(), TODAY),
      false,
    );
  });

  test("«Пора напомнить» ловит СЕГОДНЯШНЕЕ напоминание в виде timestamptz", () => {
    // Из БД после синка приходит «…T00:00:00+00» — раньше сегодняшнее
    // напоминание выпадало из списка обзвона.
    const c = client({ reminder_at: `${TODAY}T00:00:00+00:00` });
    assert.equal(matchesSegment(c, "reminderDue", stats(), TODAY), true);
    const future = client({ reminder_at: "2026-08-01T00:00:00+00:00" });
    assert.equal(matchesSegment(future, "reminderDue", stats(), TODAY), false);
  });
});

describe("matchesSegment — дыра «так и не приехали»", () => {
  test("старый лид без визитов и без записи виден", () => {
    const s = stats({ ageDays: NEW_DAYS + 10 });
    assert.equal(matchesSegment(client(), "neverCame", s, TODAY), true);
  });

  test("новичок и записанный туда НЕ попадают", () => {
    assert.equal(
      matchesSegment(client(), "neverCame", stats({ ageDays: 3 }), TODAY),
      false,
    );
    const booked = stats({
      ageDays: 90,
      nextApt: { date: "2026-08-01", time: "10:00" },
    });
    assert.equal(matchesSegment(client(), "neverCame", booked, TODAY), false);
  });

  test("до правки такой клиент не проходил НИ ОДИН статус", () => {
    const s = stats({ ageDays: 90 });
    const c = client();
    const hits = SEGMENT_OPTIONS.filter((o) =>
      matchesSegment(c, o.key, s, TODAY),
    ).map((o) => o.key);
    assert.deepEqual(hits, ["neverCame"]);
  });
});

describe("блоки статусов", () => {
  test("каждый статус попал ровно в один блок попапа", () => {
    const flat = SEGMENT_BLOCKS.flat();
    assert.equal(flat.length, SEGMENT_OPTIONS.length);
    assert.equal(new Set(flat).size, flat.length);
    for (const o of SEGMENT_OPTIONS) assert.ok(flat.includes(o.key));
  });
});

describe("ось «Ожидается»", () => {
  test("сверху самые дорогие предстоящие работы, без ожиданий — в хвост", () => {
    const list = [
      client({ id: "мало" }),
      client({ id: "нет" }),
      client({ id: "много" }),
    ];
    const map = new Map([
      ["мало", stats({ expectedRevenue: 120 })],
      ["много", stats({ expectedRevenue: 900 })],
    ]);
    assert.deepEqual(
      sortClients(list, map, "expected").map((c) => c.id),
      ["много", "мало", "нет"],
    );
  });
});

describe("статусы после разбора 2026-08-07", () => {
  test("ритм зажат снизу и сверху: «раз в 1 день» не делает пропавшим за двое суток", () => {
    // Два выезда подряд дают медиану 1 — но тревожить раньше 28 дней нельзя.
    const daily = stats({ visits: 6, medianGapDays: 1, lastVisitDays: 10 });
    assert.equal(matchesSegment(client(), "silent", daily, TODAY), false);
    const daily29 = stats({ visits: 6, medianGapDays: 1, lastVisitDays: 29 });
    assert.equal(matchesSegment(client(), "silent", daily29, TODAY), true);
    // Годовой интервал зажимается полугодом: ждать два года бессмысленно.
    const yearly = stats({ visits: 3, medianGapDays: 365, lastVisitDays: 361 });
    assert.equal(matchesSegment(client(), "silent", yearly, TODAY), true);
  });

  test("правило чёрного списка НЕ зависит от раскладки блоков", () => {
    // Раньше вычитание висело на SEGMENT_BLOCKS[0] — перестановка ряда
    // между блоками ради вёрстки молча меняла отбор.
    for (const key of OUTREACH_SEGMENTS) {
      assert.ok(
        SEGMENT_OPTIONS.some((o) => o.key === key),
        `${key} нет среди статусов`,
      );
    }
    assert.equal(OUTREACH_SEGMENTS.includes("blacklist"), false);
    assert.equal(OUTREACH_SEGMENTS.includes("loyal"), false);
  });

  test("улика второго статуса не гаснет из-за первого", () => {
    // «Должники» идут в каноническом порядке раньше «Пропали» и своей
    // улики не имеют (сумма и так в строке) — но пояснение второго
    // выбранного статуса обязано доехать.
    const s = stats({
      debt: 100,
      visits: 4,
      medianGapDays: 30,
      lastVisitDays: 87,
      lastVisitDate: "2026-04-30",
    });
    assert.equal(
      segmentEvidence(client(), ["debt", "silent"], s, TODAY),
      "не был 87 дн. · обычно раз в 30 дн.",
    );
  });

  test("склонения в улике считают по-русски", () => {
    assert.equal(
      segmentEvidence(client(), ["loyal"], stats({ visits: 22 }), TODAY),
      "22 визита",
    );
    assert.equal(
      segmentEvidence(client(), ["unclosed"], stats({ unclosedVisits: 5 }), TODAY),
      "5 визитов не закрыто",
    );
  });

  test("«Пропали» считает ЛИЧНЫЙ ритм, а не общий порог", () => {
    // Ездит раз в месяц, не был 70 дней → пропал (порог 30×2).
    const monthly = stats({
      visits: 4,
      medianGapDays: 30,
      lastVisitDays: 70,
      lastVisitDate: "2026-05-17",
    });
    assert.equal(matchesSegment(client(), "silent", monthly, TODAY), true);
    // Ездит раз в полгода, не был 70 дней → это норма, звонить рано.
    const halfYear = stats({
      visits: 3,
      medianGapDays: 180,
      lastVisitDays: 70,
      lastVisitDate: "2026-05-17",
    });
    assert.equal(matchesSegment(client(), "silent", halfYear, TODAY), false);
  });

  test("записанный вперёд не попадает в «Пропали»", () => {
    const s = stats({
      visits: 4,
      medianGapDays: 30,
      lastVisitDays: 200,
      lastVisitDate: "2026-01-07",
      nextApt: { date: "2026-08-01", time: "10:00" },
    });
    assert.equal(matchesSegment(client(), "silent", s, TODAY), false);
  });

  test("чёрный список вычитается из поводов связаться, но виден собой", () => {
    const banned = client({ blacklisted: true });
    const s = stats({ debt: 100, visits: 1 });
    assert.equal(matchesSegment(banned, "debt", s, TODAY), false);
    assert.equal(matchesSegment(banned, "birthday", stats({ birthdayInDays: 2 }), TODAY), false);
    assert.equal(matchesSegment(banned, "blacklist", s, TODAY), true);
  });

  test("незакрытая прошедшая запись видна отдельным статусом", () => {
    const s = stats({ unclosedVisits: 2 });
    assert.equal(matchesSegment(client(), "unclosed", s, TODAY), true);
    assert.equal(matchesSegment(client(), "unclosed", stats(), TODAY), false);
  });

  test("«Записаны вперёд» — единственный положительный ряд", () => {
    const s = stats({ nextApt: { date: "2026-08-01", time: "10:00" } });
    assert.equal(matchesSegment(client(), "booked", s, TODAY), true);
    assert.equal(matchesSegment(client(), "booked", stats(), TODAY), false);
  });

  test("у каждого статуса есть правило, и цифры в нём настоящие", () => {
    for (const o of SEGMENT_OPTIONS) {
      const rule = SEGMENT_RULES[o.key];
      assert.ok(rule && rule.length > 0, `нет правила у ${o.key}`);
    }
    assert.match(SEGMENT_RULES.loyal, new RegExp(String(LOYAL_VISITS)));
    assert.match(SEGMENT_RULES.birthday, new RegExp(String(BIRTHDAY_DAYS)));
  });

  test("улика объясняет КАЖДУЮ строку выбранного статуса", () => {
    const s = stats({
      visits: 4,
      medianGapDays: 30,
      lastVisitDays: 87,
      lastVisitDate: "2026-04-30",
    });
    assert.equal(
      segmentEvidence(client(), ["silent"], s, TODAY),
      "не был 87 дн. · обычно раз в 30 дн.",
    );
    // Долг уже напечатан в строке — второй раз не повторяем.
    assert.equal(
      segmentEvidence(client(), ["debt"], stats({ debt: 100, visits: 1 }), TODAY),
      null,
    );
    // Без выбранного статуса улике неоткуда взяться.
    assert.equal(segmentEvidence(client(), [], s, TODAY), null);
  });
});
