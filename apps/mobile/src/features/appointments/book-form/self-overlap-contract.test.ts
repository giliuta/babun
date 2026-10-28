import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findOverlap } from "@babun/shared/common/utils/appointment-overlap";
import { draftSlot } from "@/features/appointments/draft-slot";

// НОВАЯ ЗАПИСЬ НЕ ПЕРЕСЕКАЕТСЯ САМА С СОБОЙ. Создание кладёт её в список дня
// ещё под спиннером «Создать»; под чужим id черновик находил её и вспыхивал
// «Пересекается с событием этой команды».

const here = dirname(fileURLToPath(import.meta.url));

test("форма сверяет новую запись под её будущим id", () => {
  const form = readFileSync(resolve(here, "use-book-form.ts"), "utf8");
  assert.match(form, /editId: draft\.editId \?\? draft\.newRecordIdRef\.current,/);
});

test("только что созданная запись под своим id — не пересечение", () => {
  const created = {
    id: "new-1",
    team_id: "t1",
    date: "2026-12-01",
    time_start: "13:00",
    time_end: "13:30",
    kind: "event" as const,
    status: "scheduled",
  };
  const slot = { editId: "new-1", teamId: "t1", date: "2026-12-01", timeStart: "13:00", timeEnd: "13:30" };
  const day = [created] as never[];
  assert.equal(findOverlap(draftSlot(slot), day, { withTeamEvents: true }), null);
  assert.notEqual(
    findOverlap(draftSlot({ ...slot, editId: null }), day, { withTeamEvents: true }),
    null,
  );
});
