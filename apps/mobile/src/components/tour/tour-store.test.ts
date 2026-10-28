import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { View } from "react-native";
import {
  activeStep,
  finishTour,
  nextStep,
  registerTourTarget,
  setTourFinishHandler,
  setTourReady,
  startTour,
  tourEvent,
  tourReady,
  tourScreenShown,
  tourTarget,
  tourSnapshot,
  tourTargetTapped,
  unregisterTourTarget,
  type TourChapter,
  type TourFinish,
} from "./tour-store";

const chapter: TourChapter = {
  id: "calendar",
  about: "по календарю",
  steps: [
    { id: "a", target: "t.a", kind: "tap", text: "" },
    { id: "b", target: "t.b", kind: "input", needs: "name", text: "" },
    { id: "c", target: "t.c", kind: "tap", waitFor: "created", text: "" },
    { id: "d", target: "t.d", kind: "info", text: "" },
  ],
};

const intro: TourChapter = {
  id: "finances.intro",
  intro: "finances",
  about: "по финансам",
  steps: [{ id: "tab", target: "tab.finances", kind: "tap", required: true, text: "" }],
};

const node = (name: string) => ({ name }) as unknown as View;
const tick = () => new Promise((r) => setTimeout(r, 0));

let finished: { chapter: TourChapter; how: TourFinish }[] = [];

beforeEach(() => {
  finished = [];
  setTourFinishHandler((c, how) => finished.push({ chapter: c, how }));
  finishTour("end");
  finished = [];
});

describe("ход главы", () => {
  test("«нажмите сюда» идёт дальше по нажатию своей цели и только её", async () => {
    startTour(chapter);
    tourTargetTapped("t.other");
    await tick();
    assert.equal(activeStep()?.id, "a");
    tourTargetTapped("t.a");
    await tick();
    assert.equal(activeStep()?.id, "b");
  });

  test("шаг с ожиданием не идёт по нажатию — только по событию", async () => {
    startTour(chapter, "c");
    tourTargetTapped("t.c");
    await tick();
    assert.equal(activeStep()?.id, "c");
    tourEvent("другое");
    assert.equal(activeStep()?.id, "c");
    tourEvent("created");
    assert.equal(activeStep()?.id, "d");
  });

  test("последний шаг заканчивает главу как «дошли до конца»", () => {
    startTour(chapter, "d");
    nextStep();
    assert.equal(activeStep(), null);
    assert.deepEqual(finished.map((f) => [f.chapter.id, f.how]), [["calendar", "end"]]);
  });

  test("крестик передаёт, что закрыто: глава или всё обучение", () => {
    startTour(chapter);
    finishTour("chapter");
    startTour(intro);
    finishTour("all");
    assert.deepEqual(
      finished.map((f) => [f.chapter.id, f.chapter.intro ?? null, f.how]),
      [
        ["calendar", null, "chapter"],
        ["finances.intro", "finances", "all"],
      ],
    );
  });
});

describe("«Дальше» ждёт готовности экрана", () => {
  test("без флага готовности кнопки нет, с ним — есть", () => {
    setTourReady("name", false);
    assert.equal(tourReady("name"), false);
    setTourReady("name", true);
    assert.equal(tourReady("name"), true);
  });

  test("шаг без условия готов всегда", () => {
    assert.equal(tourReady(undefined), true);
  });
});

describe("реестр целей", () => {
  test("уходящая старая обёртка не стирает новую с тем же именем", () => {
    const a = node("a");
    const b = node("b");
    registerTourTarget("t.x", { node: a, host: "root", scroll: null, shape: "card" });
    registerTourTarget("t.x", { node: b, host: "root", scroll: null, shape: "card" });
    unregisterTourTarget("t.x", a);
    assert.equal(tourTarget("t.x")?.node, b);
    unregisterTourTarget("t.x", b);
    assert.equal(tourTarget("t.x"), undefined);
  });
});

describe("счётчик шагов", () => {
  test("«Шаг 1» — первый показанный шаг, а не первый в списке", () => {
    startTour(chapter, "c");
    const snap = tourSnapshot();
    assert.equal(snap.index, 0);
    assert.equal(snap.total, 2);
    nextStep();
    assert.equal(tourSnapshot().index, 1);
  });
});

describe("необязательный шаг без строки на экране", () => {
  test("экран открыт — по любой его цели; ушли с экрана — целей нет", () => {
    const n = node("tz");
    assert.equal(tourScreenShown("settings.hours"), false);
    registerTourTarget("settings.timezone", { node: n, host: "root", scroll: null, shape: "card" });
    assert.equal(tourScreenShown("settings.hours"), true);
    assert.equal(tourScreenShown("finances.tiles"), false);
    unregisterTourTarget("settings.timezone", n);
    assert.equal(tourScreenShown("settings.hours"), false);
  });
});

