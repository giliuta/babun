import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { City } from "@/features/reference/queries";
import {
  blockedDayNote,
  daysHeldByOthers,
  labelAddPlan,
  labelDayOwners,
  labelUsage,
  orderLabels,
  reviveIfGone,
  savableWeekdays,
  teamDaysOff,
} from "./label-rules";

const city = (id: string, extra: Partial<City> = {}) =>
  ({
    id,
    name: id,
    color: null,
    is_active: true,
    deleted_at: null,
    weekdays: [],
    ...extra,
  }) as unknown as City;

describe("orderLabels", () => {
  test("live first, hidden next, deleted last — each keeps its own order", () => {
    const list = [
      city("gone", { deleted_at: "2026-10-01T00:00:00Z", is_active: false }),
      city("hidden", { is_active: false }),
      city("a"),
      city("b"),
    ];
    assert.deepEqual(orderLabels(list).map((c) => c.id), ["a", "b", "hidden", "gone"]);
  });
});

describe("labelUsage", () => {
  test("counts days per label name", () => {
    const usage = labelUsage({ "2026-10-01": "Греция", "2026-10-02": "Греция", "2026-10-03": "Кипр" });
    assert.equal(usage.get("Греция"), 2);
    assert.equal(usage.get("Кипр"), 1);
    assert.equal(usage.get("Нет"), undefined);
  });
});

describe("labelDayOwners", () => {
  test("first live label holds the day; hidden and deleted hold nothing", () => {
    const owners = labelDayOwners([
      city("A", { weekdays: [1, 2], color: "#111111" }),
      city("B", { weekdays: [2, 3] }),
      city("hidden", { weekdays: [4], is_active: false }),
      city("gone", { weekdays: [5], deleted_at: "2026-10-01T00:00:00Z" }),
    ]);
    assert.deepEqual(owners.get(1), { name: "A", color: "#111111" });
    assert.deepEqual(owners.get(2), { name: "A", color: "#111111" });
    assert.deepEqual(owners.get(3), { name: "B", color: null });
    assert.equal(owners.has(4), false);
    assert.equal(owners.has(5), false);
  });
});

describe("teamDaysOff", () => {
  test("no schedule — no days off", () => {
    assert.equal(teamDaysOff(undefined).size, 0);
  });

  test("weekday overrides marked not working become ISO days off", () => {
    const off = teamDaysOff({
      start: "08:00",
      end: "18:00",
      overrides: {
        thu: { is_working: false, start: "08:00", end: "18:00", breaks: [] },
        sun: { is_working: false, start: "08:00", end: "18:00", breaks: [] },
      },
    });
    assert.deepEqual([...off].sort((a, b) => a - b), [4, 7]);
  });
});

describe("reviveIfGone", () => {
  test("hidden or deleted label gets the revive patch, live one gets nothing", () => {
    assert.deepEqual(reviveIfGone({ deleted_at: "2026-10-01T00:00:00Z", is_active: false }), {
      deleted_at: null,
      is_active: true,
    });
    assert.deepEqual(reviveIfGone({ deleted_at: null, is_active: false }), { deleted_at: null, is_active: true });
    assert.deepEqual(reviveIfGone({ deleted_at: null, is_active: true }), {});
  });
});

describe("blockedDayNote", () => {
  test("names the day and the reason", () => {
    assert.equal(blockedDayNote(4, "off"), "Четверг — выходной у команды");
    assert.equal(blockedDayNote(1, { holder: "Греция" }), "Понедельник занят меткой «Греция». У дня одна метка.");
  });
});

describe("daysHeldByOthers", () => {
  test("возвращаемая метка теряет дни, которые уже держит другая живая", () => {
    const back = city("back", { weekdays: [1, 2, 3], is_active: false });
    const all = [
      city("A", { weekdays: [2] }),
      city("hidden", { weekdays: [3], is_active: false }),
      back,
    ];
    assert.deepEqual(daysHeldByOthers(back, all), [2]);
  });

  test("свои дни своими не считаются", () => {
    const live = city("A", { weekdays: [1] });
    assert.deepEqual(daysHeldByOthers(live, [live]), []);
  });
});

describe("savableWeekdays", () => {
  const takenBy = labelDayOwners([city("A", { weekdays: [2] }), city("B", { weekdays: [5] })]);

  test("выходные команды и чужие дни не сохраняются", () => {
    assert.deepEqual(
      savableWeekdays([1, 2, 4, 5], { takenBy, daysOff: new Set([4]), ownName: "B" }),
      [1, 5],
    );
  });

  test("у новой метки своё имя берётся из набранного", () => {
    assert.deepEqual(
      savableWeekdays([1, 5], { takenBy, daysOff: new Set(), ownName: null, typedName: " B " }),
      [1, 5],
    );
  });
});

describe("labelAddPlan", () => {
  test("имя живой метки — отказ, а не перезапись", () => {
    const plan = labelAddPlan([city("Греция")], "греция");
    assert.equal(plan.kind, "exists");
  });

  test("имя скрытой или удалённой — возврат, новое — создание", () => {
    assert.equal(labelAddPlan([city("Кипр", { is_active: false })], "Кипр").kind, "revive");
    assert.equal(
      labelAddPlan([city("Кипр", { deleted_at: "2026-10-01T00:00:00Z", is_active: false })], "кипр").kind,
      "revive",
    );
    assert.equal(labelAddPlan([city("Кипр")], "Греция").kind, "create");
  });
});
