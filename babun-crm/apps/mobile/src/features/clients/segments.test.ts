import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  matchesSegment,
  NEW_DAYS,
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
    // Долг с минусового баланса тоже считается — как в карточке.
    assert.equal(
      matchesSegment(client({ balance: -50 }), "debtNoUpcoming", stats(), TODAY),
      true,
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
