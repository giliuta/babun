import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import {
  blockFrame,
  clashBadgeHolders,
  clashCounts,
  decksFor,
  FAN_STRIP_MIN_W,
  FAN_TOP_MIN_W,
  layoutDay,
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
    // Почти вместе (10:00 и 10:15): рядом и в Неделе, и в Дне.
    const [a, b] = layoutDay([apt("A", "10:00", "11:00"), apt("B", "10:15", "11:00")]);
    assert.equal(b.late, false);
    // В Неделе — стопкой: верхняя почти во всю ширину, у нижней край.
    const decks = decksFor([a, b], narrow);
    assert.equal(decks.get("B")?.size, 2);
    // Сверху — самая длинная (A 10:00–11:00), короткая B под ней краем.
    assert.equal(decks.get("A")?.index, 1);
    const top = blockFrame(a, narrow, 3, decks.get("A"));
    const under = blockFrame(b, narrow, 3, decks.get("B"));
    assert.ok(top.width >= narrow - 10, `верхняя стопки ${top.width}`);
    assert.ok(top.z > under.z && top.left > under.left, "верхняя лежит поверх со сдвигом");
    // В Дне стопок нет — рядом.
    assert.equal(decksFor([a, b], wide).size, 0);
    // Позже (10:00 и 11:00 при A до 12:00): в Неделе — веер.
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

describe("накладка записей", () => {
  const narrow = SIDE_BY_SIDE_MIN_W - 90;
  test("перенесённая на занятое время ложится сверху стопки, а не под соседку", () => {
    const placed = layoutDay([
      apt("LONG", "13:00", "14:00", "2026-09-25T08:00:00Z"),
      apt("MOVED", "13:00", "13:30", "2026-09-25T09:00:00Z"),
    ]);
    const decks = decksFor(placed, narrow);
    assert.equal(decks.get("MOVED")?.index, 1);
    assert.equal(decks.get("LONG")?.index, 0);
  });

  test("накладку считают только рабочие записи, не события и не отменённые", () => {
    const event = { ...apt("EV", "10:00", "11:00"), kind: "event" as const };
    const cancelled = { ...apt("X", "10:00", "11:00"), status: "cancelled" as const };
    const clash = clashCounts(
      layoutDay([apt("A", "10:00", "11:00"), apt("B", "10:30", "11:30"), apt("C", "12:00", "13:00"), event, cancelled]),
    );
    assert.equal(clash.get("A"), 1);
    assert.equal(clash.get("B"), 1);
    assert.equal(clash.has("C"), false);
    assert.equal(clash.has("EV"), false);
    assert.equal(clash.has("X"), false);
  });
});

describe("значок накладки", () => {
  test("в стопке — у верхней карточки, числом всей стопки", () => {
    const placed = layoutDay([apt("A", "10:00", "11:00"), apt("B", "10:00", "11:00", "2026-09-25T09:00:00Z")]);
    const decks = decksFor(placed, SIDE_BY_SIDE_MIN_W - 90);
    const holders = clashBadgeHolders(placed, decks);
    assert.deepEqual([...holders], [["B", 1]]);
  });
  test("вне стопки — у той, что поверх соседки", () => {
    const placed = layoutDay([apt("A", "10:00", "12:00"), apt("B", "11:00", "12:00")]);
    const holders = clashBadgeHolders(placed, decksFor(placed, SIDE_BY_SIDE_MIN_W - 90));
    assert.deepEqual([...holders], [["B", 1]]);
  });
  test("событие поверх записи — не накладка", () => {
    const placed = layoutDay([apt("A", "10:00", "11:00"), { ...apt("E", "10:00", "11:00"), kind: "event" as const }]);
    assert.equal(clashBadgeHolders(placed, decksFor(placed, SIDE_BY_SIDE_MIN_W - 90)).size, 0);
  });
});
