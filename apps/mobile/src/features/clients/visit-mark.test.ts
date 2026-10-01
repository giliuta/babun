import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { visitMark } from "./visit-mark";

const none = { lastVisitDate: "", lastUnclosedDate: "", nextApt: null };

describe("дата в строке клиента", () => {
  test("последний визит закрыт — синяя дата визита", () => {
    assert.deepEqual(visitMark({ ...none, lastVisitDate: "2026-08-14" }), { date: "2026-08-14", kind: "done" });
  });

  test("последним был незакрытый визит — жёлтая дата его", () => {
    assert.deepEqual(
      visitMark({ ...none, lastVisitDate: "2026-08-14", lastUnclosedDate: "2026-09-20" }),
      { date: "2026-09-20", kind: "unclosed" },
    );
  });

  test("незакрытый раньше закрытого — последний закрытый, синим", () => {
    assert.deepEqual(
      visitMark({ ...none, lastVisitDate: "2026-09-20", lastUnclosedDate: "2026-08-14" }),
      { date: "2026-09-20", kind: "done" },
    );
  });

  test("визитов не было, есть запись впереди — серая дата записи", () => {
    assert.deepEqual(visitMark({ ...none, nextApt: { date: "2026-10-03", time: "10:00" } }), {
      date: "2026-10-03",
      kind: "ahead",
    });
  });

  test("записей нет — ничего", () => {
    assert.equal(visitMark(none), null);
    assert.equal(visitMark(undefined), null);
  });
});
