import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFields } from "./member-writes";
import { withBaselineStatus } from "./edit-baseline";

// Подпись формы — `JSON.stringify(buildPatch())`; снимок — та же строка,
// снятая после гидрации. Оплата меняет в базе только статус.

const patch = (over: Record<string, unknown> = {}) => ({
  kind: "work",
  date: "2026-10-03",
  time_start: "10:00",
  comment: "",
  status: "scheduled",
  total_amount: 135,
  ...over,
});

describe("withBaselineStatus", () => {
  test("статус от сервера — не правка: подпись совпадает со снимком", () => {
    const baseline = JSON.stringify(patch());
    const next = withBaselineStatus(baseline, "completed");
    assert.equal(next, JSON.stringify(patch({ status: "completed" })));
  });

  test("несохранённая правка остаётся правкой после оплаты", () => {
    const baseline = withBaselineStatus(JSON.stringify(patch()), "completed");
    const form = patch({ status: "completed", comment: "код ворот 1234" });
    assert.notEqual(JSON.stringify(form), baseline);
    assert.deepEqual(
      changedFields(JSON.parse(baseline ?? "{}"), form as never),
      { comment: "код ворот 1234" },
    );
  });

  test("снимка ещё нет — его снимет гидрация", () => {
    assert.equal(withBaselineStatus(null, "completed"), null);
  });
});
