import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, test } from "node:test";
import type { TourChapter } from "@/components/tour/tour-store";
import { CABINET_CHAPTER } from "./cabinet-chapter";
import { CALENDAR_CHAPTER, CALENDAR_GRID_START } from "./calendar-chapter";
import { CLIENTS_CHAPTER } from "./clients-chapter";
import { FINANCES_CHAPTER, FINANCES_PAGE_START } from "./finances-chapter";
import { CHAPTER_ORDER, lockedByOnboarding, nextChapter, WRITTEN_CHAPTERS } from "./chapter-order";

// Шаг, чьей цели нет ни на одном экране, обучение не покажет: обязательный
// встанет навсегда (подсказки нет, а «Пропустить» у него не бывает), и
// человек застрянет с запертыми вкладками. Шаг, ждущий события, которого
// приложение не шлёт, — то же самое.

const here = import.meta.dirname;
const MOBILE = resolve(here, "../../..");
const CHAPTERS: readonly TourChapter[] = [CALENDAR_CHAPTER, FINANCES_CHAPTER, CLIENTS_CHAPTER, CABINET_CHAPTER];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && !/-chapter\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const code = [...sources(join(MOBILE, "src")), ...sources(join(MOBILE, "app"))]
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

describe("главы обучения", () => {
  test("порядок глав — порядок разделов, и написаны все", () => {
    assert.deepEqual(
      CHAPTERS.map((c) => c.id),
      [...CHAPTER_ORDER],
    );
    for (const id of CHAPTER_ORDER) assert.ok(WRITTEN_CHAPTERS.has(id), `глава «${id}» не отмечена написанной`);
  });

  for (const chapter of CHAPTERS) {
    test(`«${chapter.id}»: у каждого шага цель стоит на экране`, () => {
      for (const step of chapter.steps) {
        assert.ok(code.includes(`"${step.target}"`), `шаг ${step.id}: цели «${step.target}» нет ни в одном TourTarget`);
      }
    });

    test(`«${chapter.id}»: события, которых ждут шаги, приложение шлёт`, () => {
      for (const step of chapter.steps) {
        if (!step.waitFor) continue;
        assert.ok(code.includes(`tourEvent("${step.waitFor}")`), `шаг ${step.id}: никто не шлёт «${step.waitFor}»`);
      }
    });

    test(`«${chapter.id}»: имена шагов не повторяются`, () => {
      const ids = chapter.steps.map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length);
    });
  }

  test("точки входа в середину главы — настоящие шаги", () => {
    assert.ok(CALENDAR_CHAPTER.steps.some((s) => s.id === CALENDAR_GRID_START));
    assert.ok(FINANCES_CHAPTER.steps.some((s) => s.id === FINANCES_PAGE_START));
  });

  test("каждая глава кроме календаря стартует со своей вкладки", () => {
    const runner = readFileSync(join(here, "OnboardingRunner.tsx"), "utf8");
    for (const chapter of [FINANCES_CHAPTER, CLIENTS_CHAPTER, CABINET_CHAPTER]) {
      assert.match(runner, new RegExp(`${chapter.id}: \\{\\s*chapter: [A-Z_]+,\\s*tab: "${chapter.id}"`));
    }
  });
});

describe("очерёдность разделов", () => {
  test("пока не пройден календарь, закрыто всё остальное", () => {
    assert.equal(lockedByOnboarding([], "finances"), true);
    assert.equal(lockedByOnboarding([], "cabinet"), true);
    assert.equal(nextChapter([]), "calendar");
  });

  test("раздел открывается после глав перед ним", () => {
    assert.equal(lockedByOnboarding(["calendar"], "finances"), false);
    assert.equal(lockedByOnboarding(["calendar"], "clients"), true);
    assert.equal(lockedByOnboarding(["calendar", "finances"], "clients"), false);
    assert.equal(lockedByOnboarding(["calendar", "finances"], "cabinet"), true);
    assert.equal(nextChapter(["calendar", "finances", "clients"]), "cabinet");
    assert.equal(nextChapter([...CHAPTER_ORDER]), null);
  });

  test("без обучения (старый владелец, сотрудник) не закрыто ничего", () => {
    assert.equal(lockedByOnboarding(null, "cabinet"), false);
    assert.equal(nextChapter(null), null);
  });
});
