import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CALENDAR_CHAPTER, CALENDAR_GRID_START } from "./calendar-chapter";
import { FINANCES_CHAPTER, FINANCES_PAGE_START } from "./finances-chapter";
import { resumeStep, savedStepKey } from "./resume";

describe("глава продолжается с того же шага", () => {
  test("ничего не сохранено — обычное начало", () => {
    assert.equal(resumeStep(CALENDAR_CHAPTER, undefined, null), undefined);
    assert.equal(resumeStep(CALENDAR_CHAPTER, CALENDAR_GRID_START, null), CALENDAR_GRID_START);
  });

  test("сохранённый шаг этой главы — с него", () => {
    const saved = { chapter: "calendar", step: "set.hours" };
    assert.equal(resumeStep(CALENDAR_CHAPTER, CALENDAR_GRID_START, saved), "set.hours");
  });

  test("календарь уже создан — к шагам создания не возвращаемся", () => {
    const saved = { chapter: "calendar", step: "cal.name" };
    assert.equal(resumeStep(CALENDAR_CHAPTER, CALENDAR_GRID_START, saved), CALENDAR_GRID_START);
  });

  test("шаг чужой главы или исчезнувший шаг — обычное начало", () => {
    assert.equal(
      resumeStep(FINANCES_CHAPTER, FINANCES_PAGE_START, { chapter: "calendar", step: "set.hours" }),
      FINANCES_PAGE_START,
    );
    assert.equal(
      resumeStep(FINANCES_CHAPTER, FINANCES_PAGE_START, { chapter: "finances", step: "fin.нет" }),
      FINANCES_PAGE_START,
    );
  });

  test("место своё у человека в каждом аккаунте", () => {
    assert.notEqual(savedStepKey("u1", "t1"), savedStepKey("u1", "t2"));
    assert.notEqual(savedStepKey("u1", "t1"), savedStepKey("u2", "t1"));
  });
});

describe("возврат, когда экран шага закрыли", () => {
  const steps = [...CALENDAR_CHAPTER.steps];
  const byId = new Map(steps.map((s) => [s.id, s]));

  test("шаги шторки создания возвращают к «Создать календарь»", () => {
    for (const id of ["cal.name", "cal.color", "cal.submit"]) {
      assert.equal(byId.get(id)?.fallback, "cal.create", id);
    }
  });

  test("шаги настроек возвращают к шестерёнке", () => {
    for (const step of steps.filter((s) => s.target.startsWith("settings."))) {
      assert.equal(step.fallback, "cal.gear", step.id);
    }
  });

  test("возврат ведёт на шаг той же главы, стоящий раньше", () => {
    for (const step of steps) {
      if (!step.fallback) continue;
      const to = steps.findIndex((s) => s.id === step.fallback);
      assert.ok(to >= 0 && to < steps.indexOf(step), step.id);
    }
  });
});
