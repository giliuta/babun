import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { asRecordWindow, hiddenByWindow, recordWindowStart } from "./record-window";

describe("«Ограничения» записей календаря — окно как у сервера", () => {
  test("начало окна: недели днями, месяцы — как Postgres", () => {
    assert.equal(recordWindowStart("week", "2026-10-03"), "2026-09-26");
    assert.equal(recordWindowStart("near", "2026-10-03"), "2026-09-19");
    assert.equal(recordWindowStart("month", "2026-10-03"), "2026-09-03");
    assert.equal(recordWindowStart("quarter", "2026-10-03"), "2026-07-03");
    assert.equal(recordWindowStart("half", "2026-10-03"), "2026-04-03");
    assert.equal(recordWindowStart("own", "2026-10-03"), null);
    // 31 марта минус месяц — 28 февраля (Postgres), а не 3 марта.
    assert.equal(recordWindowStart("month", "2026-03-31"), "2026-02-28");
    assert.equal(recordWindowStart("half", "2026-08-31"), "2026-02-28");
  });

  test("прячется только прошедшая работа старше окна", () => {
    const today = "2026-10-03";
    assert.equal(hiddenByWindow({ kind: "work", date: "2026-09-25" }, "week", today), true);
    assert.equal(hiddenByWindow({ kind: "work", date: "2026-09-26" }, "week", today), false);
    assert.equal(hiddenByWindow({ kind: "work", date: "2026-10-10" }, "week", today), false);
    assert.equal(hiddenByWindow({ kind: "event", date: "2026-01-01" }, "week", today), false);
    assert.equal(hiddenByWindow({ kind: "work", date: "2020-01-01" }, "own", today), false);
  });

  test("неизвестная ступень — самое узкое, «Неделя»; «all» — без ограничения", () => {
    assert.equal(asRecordWindow(undefined), "week");
    assert.equal(asRecordWindow("zzz"), "week");
    assert.equal(asRecordWindow("all"), "own");
    assert.equal(asRecordWindow("half"), "half");
  });
});
