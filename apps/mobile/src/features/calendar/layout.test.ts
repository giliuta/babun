import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import {
  blockFrame,
  FAN_STRIP_MIN_W,
  FAN_TOP_MIN_W,
  fitLanes,
  lanesFor,
  layoutDay,
  MIN_LANE_W,
  moreFrame,
  SIDE_BY_SIDE_MIN_W,
} from "./layout";

const apt = (id: string, time_start: string, time_end: string, updated_at = "2026-09-25T08:00:00Z") => ({
  ...createBlankAppointment({ id, date: "2026-09-25", time_start, time_end }),
  updated_at,
});

const byId = (placed: ReturnType<typeof layoutDay>) =>
  Object.fromEntries(placed.map((p) => [p.apt.id, p]));

describe("раскладка пересекающихся записей", () => {
  test("растянутая запись не пересекается ни с кем в занятых колонках", () => {
    const placed = layoutDay([
      apt("A", "10:00", "12:00"),
      apt("B", "10:00", "11:00"),
      apt("C", "11:00", "12:00"),
      apt("D", "10:00", "10:30"),
      apt("E", "11:00", "12:00"),
      apt("F", "12:30", "13:00"),
    ]);
    for (const p of placed) {
      assert.ok(p.colSpan >= 1 && p.colIndex + p.colSpan <= p.colCount);
      for (const q of placed) {
        if (q === p) continue;
        const sameCluster = q.colCount === p.colCount;
        const inSpan = q.colIndex >= p.colIndex && q.colIndex < p.colIndex + p.colSpan;
        const overlap = p.startMin < q.endMin && q.startMin < p.endMin;
        assert.ok(!(sameCluster && inSpan && overlap), `${p.apt.id} накрывает ${q.apt.id}`);
      }
    }
    // Отдельная кучка — во всю ширину.
    const f = byId(placed).F;
    assert.equal(f.colCount, 1);
  });

  test("запись растягивается, когда справа на её время пусто", () => {
    // D 10–10:30 → колонка 0; A 10–11 → 1; B 10–12 → 2; E 11–12 → колонка 0,
    // A к 11:00 кончилась — E забирает и колонку 1.
    const p = byId(
      layoutDay([
        apt("A", "10:00", "11:00"),
        apt("B", "10:00", "12:00"),
        apt("D", "10:00", "10:30"),
        apt("E", "11:00", "12:00"),
      ]),
    );
    assert.equal(p.E.colIndex, 0);
    assert.equal(p.E.colSpan, 2);
    assert.equal(p.B.colSpan, 1);
  });

  test("начались вместе — рядом; позже — веером поверх почти во всю ширину", () => {
    const narrow = 55;
    const wide = SIDE_BY_SIDE_MIN_W + 200;
    // Почти вместе (10:00 и 10:15): пополам и в Неделе, и в Дне.
    const [a, b] = layoutDay([apt("A", "10:00", "11:00"), apt("B", "10:15", "11:00")]);
    assert.equal(b.late, false);
    const fa = blockFrame(a, narrow, 3);
    const fb = blockFrame(b, narrow, 3);
    assert.equal(fa.overlapped || fb.overlapped, false);
    assert.ok(fa.left + fa.width <= fb.left, "половинки не налезают");
    // Позже (10:00 и 11:00 при C до 12:00): в Неделе — веер.
    const [c, d] = layoutDay([apt("C", "10:00", "12:00"), apt("D", "11:00", "11:30")]);
    assert.equal(d.late, true);
    const nc = blockFrame(c, narrow, 3);
    const nd = blockFrame(d, narrow, 3);
    assert.equal(nd.overlapped, true);
    assert.ok(nd.z > nc.z, "поздняя лежит поверх");
    assert.ok(nd.width > narrow / 2, `ширина поздней ${nd.width}`);
    assert.ok(nd.left - nc.left >= FAN_STRIP_MIN_W, "у ранней видна полоса слева");
    assert.ok(nd.width >= FAN_TOP_MIN_W, `у поздней место под имя: ${nd.width}`);
    // В Дне — всегда рядом.
    assert.equal(blockFrame(d, wide, 3).overlapped, false);
  });
});

describe("дорожки и «+N»", () => {
  const WEEK = 50;
  const DAY = 354;
  const ids = (list: { apt: { id: string } }[]) => list.map((p) => p.apt.id).sort();
  const fit = (laneW: number, list: ReturnType<typeof apt>[], pinned: string | null = null) =>
    fitLanes(layoutDay(list), laneW, pinned);

  test("дорожек — не меньше двух; в Дне iPhone — пять", () => {
    assert.equal(lanesFor(0), 2);
    assert.equal(lanesFor(WEEK), 2);
    assert.equal(lanesFor(SIDE_BY_SIDE_MIN_W), 2);
    assert.equal(lanesFor(DAY), 5);
    assert.equal(lanesFor(MIN_LANE_W * 7 + 1), 7);
  });

  test("одна запись — во всю колонку, «+N» нет", () => {
    const { shown, more } = fit(WEEK, [apt("A", "10:00", "11:00")]);
    assert.equal(more.length, 0);
    assert.equal(shown[0].colCount, 1);
    assert.deepEqual(blockFrame(shown[0], WEEK, 3), { left: 1, width: WEEK - 3, z: 0, overlapped: false });
  });

  test("две в одно время — Неделя пополам, каждая своей половинкой", () => {
    const { shown, more } = fit(WEEK, [apt("A", "10:00", "11:00"), apt("B", "10:00", "11:00")]);
    assert.equal(more.length, 0);
    assert.deepEqual(ids(shown), ["A", "B"]);
    const [fa, fb] = shown.map((p) => blockFrame(p, WEEK, 3));
    assert.equal(fa.width, WEEK / 2 - 3);
    assert.equal(fb.left, WEEK / 2 + 1);
    assert.equal(fa.overlapped || fb.overlapped, false);
  });

  test("три в одно время — Неделя: первая и «+2» во второй половинке", () => {
    const { shown, more } = fit(WEEK, [
      apt("A", "10:00", "11:00"),
      apt("B", "10:00", "11:00"),
      apt("C", "10:00", "11:00"),
    ]);
    assert.deepEqual(ids(shown), ["A"]);
    assert.equal(shown[0].colCount, 2);
    assert.equal(shown[0].colSpan, 1);
    assert.equal(more.length, 1);
    assert.deepEqual(ids(more[0].members), ["B", "C"]);
    assert.equal(more[0].colIndex, 1);
    const card = moreFrame(more[0], WEEK, 3);
    assert.equal(card.left, WEEK / 2 + 1);
    assert.equal(card.width, WEEK / 2 - 3);
  });

  test("четыре в одно время — Неделя «+3», День — все рядом", () => {
    const four = ["A", "B", "C", "D"].map((id) => apt(id, "10:00", "11:00"));
    const week = fit(WEEK, four);
    assert.deepEqual(ids(week.shown), ["A"]);
    assert.equal(week.more[0].members.length, 3);
    const day = fit(DAY, four);
    assert.equal(day.more.length, 0);
    assert.equal(day.shown.length, 4);
    for (const p of day.shown) assert.ok(blockFrame(p, DAY, 3).width >= MIN_LANE_W, "не уже читаемого");
  });

  test("День: шесть в одно время — четыре дорожки и «+2» пятой", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((id) => apt(id, "10:00", "11:00"));
    const { shown, more } = fit(DAY, six);
    assert.deepEqual(ids(shown), ["A", "B", "C", "D"]);
    assert.equal(more.length, 1);
    assert.equal(more[0].colIndex, 4);
    assert.deepEqual(ids(more[0].members), ["E", "F"]);
    for (const p of shown) assert.ok(blockFrame(p, DAY, 3).width >= MIN_LANE_W - 3);
  });

  test("частичное пересечение: лишняя одна — сама запись, а не «+1»", () => {
    // A 10–12 · B 10–11 · C 10–10:30 · D 11–12: в 10:00 их три, в 11:00 — две.
    const { shown, more } = fit(WEEK, [
      apt("A", "10:00", "12:00"),
      apt("B", "10:00", "11:00"),
      apt("C", "10:00", "10:30"),
      apt("D", "11:00", "12:00"),
    ]);
    assert.equal(more.length, 1);
    assert.deepEqual(ids(more[0].members), ["B", "C"]);
    assert.equal(more[0].startMin, 600);
    assert.equal(more[0].endMin, 660);
    // D в 11:00 одна рядом с A — своей половинкой, без карточки.
    const d = shown.find((p) => p.apt.id === "D")!;
    assert.equal(d.colIndex, 1);
    assert.equal(d.colCount, 2);
  });

  test("цепочка без трёх одновременных — все видны, «+N» нет", () => {
    const { shown, more } = fit(WEEK, [
      apt("A", "09:00", "10:00"),
      apt("B", "09:30", "10:30"),
      apt("C", "10:00", "11:00"),
      apt("D", "10:30", "11:30"),
      apt("E", "11:00", "12:00"),
    ]);
    assert.equal(more.length, 0);
    assert.equal(shown.length, 5);
    for (const p of shown) assert.equal(p.colCount, 2);
  });

  test("дорожку «+N» на её время соседка не забирает", () => {
    // Дорожку «+N» на её время не забирает никто.
    const { shown, more } = fit(WEEK, [
      apt("A", "10:00", "12:00"),
      apt("B", "10:00", "11:00"),
      apt("C", "10:00", "11:00"),
    ]);
    assert.equal(more.length, 1);
    assert.equal(shown[0].apt.id, "A", "длинная — в первой дорожке");
    assert.equal(shown[0].colSpan, 1, "в дорожку «+N» не лезет");
  });

  test("запись в свободном перемещении не прячется в «+N»", () => {
    const three = [apt("A", "10:00", "11:00"), apt("B", "10:00", "11:00"), apt("C", "10:00", "11:00")];
    const { shown, more } = fit(WEEK, three, "C");
    assert.ok(shown.some((p) => p.apt.id === "C" && p.colIndex === 1));
    // Дорожку держит перетаскиваемая — соседке остаётся «+1» под ней.
    assert.deepEqual(ids(more[0].members), ["B"]);
  });

  test("каждая запись — либо на сетке, либо в «+N», ровно один раз", () => {
    const list = [
      apt("A", "08:00", "12:00"),
      apt("B", "09:00", "10:00"),
      apt("C", "09:15", "11:00"),
      apt("D", "09:30", "09:45"),
      apt("E", "10:00", "13:00"),
      apt("F", "12:30", "14:00"),
      apt("G", "15:00", "16:00"),
    ];
    for (const laneW of [WEEK, 140, DAY]) {
      const { shown, more } = fit(laneW, list);
      const all = [...shown.map((p) => p.apt.id), ...more.flatMap((m) => m.members.map((p) => p.apt.id))];
      assert.deepEqual(all.sort(), list.map((a) => a.id).sort(), `колонка ${laneW}`);
    }
  });
});
