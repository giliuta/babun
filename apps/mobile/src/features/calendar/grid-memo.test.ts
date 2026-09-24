import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  blockPropsEqual,
  dayColumnPropsEqual,
  latestCaller,
  sameItems,
  sameShallow,
  sameWorkBand,
} from "./grid-memo";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");
/** Код без комментариев: сторож не должен зеленеть от слова в пояснении. */
const code = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("сравнение пропсов сетки", () => {
  test("полоса графика равна по содержимому, выходной и «не знаем» — разные", () => {
    const a = { startMin: 540, endMin: 1080, breaks: [{ startMin: 780, endMin: 840 }] };
    const b = { startMin: 540, endMin: 1080, breaks: [{ startMin: 780, endMin: 840 }] };
    assert.equal(sameWorkBand(a, b), true);
    assert.equal(sameWorkBand(a, { ...b, endMin: 1020 }), false);
    assert.equal(
      sameWorkBand(a, { ...b, breaks: [{ startMin: 780, endMin: 900 }] }),
      false,
      "другой перерыв — другая серая полоса на колонке",
    );
    assert.equal(sameWorkBand(a, { startMin: 540, endMin: 1080 }), false);
    assert.equal(sameWorkBand(null, null), true);
    assert.equal(sameWorkBand(null, undefined), false);
  });

  test("записи дня равны, когда элементы те же; перенос даёт новый объект", () => {
    const x = { id: "1" };
    const y = { id: "2" };
    assert.equal(sameItems([], []), true, "пустой день приходит свежим []");
    assert.equal(sameItems([x, y], [x, y]), true);
    assert.equal(sameItems([x, y], [x, { ...y }]), false);
    assert.equal(sameItems([x, y], [y, x]), false);
    assert.equal(sameItems([x], [x, y]), false);
    assert.equal(sameItems(undefined, []), false, "нет режима подбора ≠ свободного нет");
  });

  test("колонка не перерисовывается от новых объектов с тем же содержимым", () => {
    const apt = { id: "1" };
    const handler = () => {};
    const base = {
      dateYmd: "2026-09-15",
      appointments: [apt],
      workBand: { startMin: 540, endMin: 1080, breaks: [] },
      freeSlots: undefined,
      onEdit: handler,
      nowMinutes: null as number | null,
    };
    assert.equal(
      dayColumnPropsEqual(base, {
        ...base,
        appointments: [apt],
        workBand: { startMin: 540, endMin: 1080, breaks: [] },
      }),
      true,
    );
    assert.equal(dayColumnPropsEqual(base, { ...base, onEdit: () => {} }), false);
    assert.equal(dayColumnPropsEqual(base, { ...base, nowMinutes: 600 }), false);
    assert.equal(
      dayColumnPropsEqual(base, { ...base, appointments: [{ ...apt }] }),
      false,
      "изменённая запись обязана перерисовать колонку",
    );
    const withResolver = { ...base, clientName: (a: { id: string }) => a.id };
    assert.equal(
      dayColumnPropsEqual(withResolver, { ...withResolver, clientName: () => "Иван" }),
      false,
      "резолвер имени сравнивается по ссылке: иначе новые имена не дойдут до сетки",
    );
  });

  test("блок не перерисовывается от пересозданного размещения той же записи", () => {
    const apt = { id: "1" };
    const placed = { apt, startMin: 600, endMin: 660, colIndex: 0, colCount: 1 };
    const base = { placed, hourH: 64, label: "Иван" };
    assert.equal(blockPropsEqual(base, { ...base, placed: { ...placed } }), true);
    assert.equal(
      blockPropsEqual(base, { ...base, placed: { ...placed, colIndex: 1, colCount: 2 } }),
      false,
      "сосед наложился — блок сузился",
    );
    assert.equal(
      blockPropsEqual(base, { ...base, placed: { ...placed, apt: { ...apt } } }),
      false,
    );
    assert.equal(sameShallow({ a: 1 }, { a: 1, b: 2 }), false);
  });

  test("стабильный обработчик зовёт свежую функцию, а не ту, что была при создании", () => {
    const box = { current: (n: number) => `старый ${n}` };
    const call = latestCaller(box);
    box.current = (n: number) => `новый ${n}`;
    assert.equal(call(1), "новый 1");
  });
});

describe("сетка календаря мемоизирована и кормится стабильными пропсами", () => {
  const dayView = code(read("./DayView.tsx"));
  // Блок записи вынесен в свой файл 24.09 — сторож смотрит туда.
  const blockFile = code(read("./AppointmentBlock.tsx"));
  const weekView = code(read("./WeekView.tsx"));
  const hook = code(read("./use-latest-handler.ts"));
  const screen = code(read("../../../app/(dashboard)/(home)/index.tsx"));

  test("колонка, блок, День и Неделя обёрнуты в memo", () => {
    assert.match(blockFile, /export const AppointmentBlock = memo\(function AppointmentBlock\(/);
    assert.match(blockFile, /\}, blockPropsEqual\);/);
    assert.match(dayView, /export const DayColumn = memo\(function DayColumn\(/);
    assert.match(dayView, /\}, dayColumnPropsEqual\);/);
    assert.match(dayView, /export const DayView = memo\(function DayView\(/);
    assert.match(weekView, /export const WeekView = memo\(function WeekView\(/);
  });

  test("«сейчас» получает только колонка сегодня", () => {
    assert.match(dayView, /nowMinutes=\{d === todayYmd \? nowMinutes : null\}/);
    assert.match(weekView, /nowMinutes=\{sameDay\(d, today\) \? nowMinutes : null\}/);
  });

  test("коробка обработчика обновляется в коммите, а не во время отрисовки", () => {
    assert.match(hook, /useLayoutEffect\(\(\) => \{\s*box\.current = fn;\s*\}\);/);
    const outsideEffect = hook.replace(/useLayoutEffect\(\(\) => \{[\s\S]*?\}\);/, "");
    assert.doesNotMatch(
      outsideEffect,
      /box\.current\s*=/,
      "запись в ref при отрисовке оставила бы замыкание отброшенного перехода",
    );
  });

  test("gridProps собраны в useMemo, обработчики жестов — свежие обёртки", () => {
    assert.match(screen, /const gridProps = useMemo\(/);
    for (const fn of ["openEdit", "openActionMenu", "createAt", "reschedule"]) {
      assert.match(screen, new RegExp(`useLatestHandler\\(${fn}\\)`), fn);
    }
    const grid = screen.slice(screen.indexOf("const gridProps = useMemo("));
    // Тело — после фабрики `() => ({` самого useMemo: её стрелка законна.
    const opening = "() => ({";
    assert.ok(grid.includes(opening));
    const body = grid.slice(grid.indexOf(opening) + opening.length, grid.indexOf("\n  );"));
    assert.match(body, /onEdit: onEditGrid,/);
    // Сотрудник двигает по «Переносить» (STORY-088): обработчик есть и у
    // него, а можно ли двигать эту запись — отвечает `canReschedule`.
    assert.match(body, /onReschedule: canManageBookings \|\| isCrew \? rescheduleGrid : undefined,/);
    assert.match(body, /onZoom,/);
    assert.doesNotMatch(body, /=>/, "стрелка внутри gridProps — новая функция на каждый рендер");
    assert.match(screen, /const clientName = useCallback\(/);
  });

  test("палитра ситуаций — стабильной ссылкой: иначе резолверы цвета и memo сетки новые на каждый рендер", () => {
    // `useSituationPalette` собирает объект заново при каждом вызове, а
    // палитра стоит в зависимостях `teamColorFor`, тот — в `gridProps`, те —
    // в пропсах Недели, Дня и каждой колонки.
    assert.match(
      screen,
      /const situationPalette = useMemo<SituationPalette>\(\s*\(\) => \(\{\s*noClient: paletteRaw\.noClient,\s*noObject: paletteRaw\.noObject,\s*noServices: paletteRaw\.noServices,?\s*\}\),\s*\[paletteRaw\.noClient, paletteRaw\.noObject, paletteRaw\.noServices\],?\s*\);/,
    );
    assert.doesNotMatch(
      screen,
      /const situationPalette = useSituationPalette\(/,
      "палитра прямо из хука — новый объект на каждый рендер",
    );
  });

  test("в пропсах Недели и Дня нет стрелок: иначе memo сетки мёртв", () => {
    for (const tag of ["WeekView", "DayView"]) {
      const jsx = screen.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`));
      assert.ok(jsx, tag);
      assert.doesNotMatch(jsx[0], /=>/, `<${tag}> получил стрелку в пропе`);
      assert.match(jsx[0], /\{\.\.\.gridProps\}/);
    }
  });

  test("тап по своему чипу: подсветка сразу, сетка — переходом", () => {
    assert.match(screen, /const \[chipTeamId, showChipTeam\] = useOptimistic\(activeTeamId\);/);
    assert.match(screen, /activeId=\{pendingChipId \?\? chipTeamId\}/);
    const start = screen.indexOf("onPickOwn: (teamId) => {");
    assert.ok(start >= 0);
    const pickOwn = screen.slice(start, screen.indexOf("rememberView({ teamId });", start));
    assert.match(
      pickOwn,
      /startTransition\(\(\) => \{\s*showChipTeam\(teamId\);\s*setTeamChoice\(teamId\);\s*\}\);/,
    );
    assert.equal(
      pickOwn.split("setTeamChoice(").length - 1,
      1,
      "setTeamChoice вне перехода снова заставит чип ждать отрисовки сетки",
    );
  });
});
