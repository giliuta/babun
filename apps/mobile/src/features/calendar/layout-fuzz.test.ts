import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { blockFrame, decksFor, layoutDay } from "./layout";

// ЖЁСТКАЯ ПРОВЕРКА РАСКЛАДКИ ДНЯ (аудит 03.10, «ломать то, что пользователь не
// делает»): тысячи случайных дней — пустые и битые времена, конец раньше
// начала, 24:00, десятки записей в одну минуту — и узкие колонки Недели.
// Каждый блок обязан остаться видимым (ширина > 0, внутри колонки), а
// пересекающиеся рядом — не налезать друг на друга.

let seed = 20261003;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const WEIRD = ["", "24:00", "23:59", "00:00", "abc", "25:70", "7:5", "12"];

function randomDay(n: number): Appointment[] {
  return Array.from({ length: n }, (_, i) => {
    const sameMinute = rand() < 0.3;
    const start = sameMinute ? 600 : Math.floor(rand() * 1440);
    const len = pick([0, 1, 15, 30, 60, 240, -30, 1500]);
    return {
      id: `a${i}`,
      time_start: rand() < 0.05 ? pick(WEIRD) : hm(start),
      time_end: rand() < 0.05 ? pick(WEIRD) : hm(Math.max(0, Math.min(1439, start + len))),
    } as Appointment;
  });
}

describe("раскладка дня под нагрузкой", () => {
  test("каждый блок видим и внутри колонки, рядом стоящие не налезают", () => {
    for (let round = 0; round < 3000; round++) {
      const day = randomDay(1 + Math.floor(rand() * 40));
      const placed = layoutDay(day);
      assert.equal(placed.length, day.length);
      for (const laneW of [44, 52, 90, 139, 140, 360]) {
        const decks = decksFor(placed, laneW);
        for (const p of placed) {
          assert.ok(Number.isFinite(p.startMin) && Number.isFinite(p.endMin), "время — число");
          assert.ok(p.endMin > p.startMin, "у блока есть высота");
          assert.ok(p.colIndex >= 0 && p.colIndex + p.colSpan <= p.colCount, "колонка в пределах");
          const f = blockFrame(p, laneW, 3, decks.get(p.apt.id));
          assert.ok(f.width > 0, `ширина ${f.width} при колонке ${laneW} и стопке ${decks.get(p.apt.id)?.size}`);
          assert.ok(f.left >= 0 && f.left + f.width <= laneW + 0.001, "внутри колонки");
        }
        if (laneW >= 140) {
          // «Рядом» не налезают; «веер» лежит поверх намеренно.
          const beside = (x: (typeof placed)[number]) =>
            !blockFrame(x, laneW, 3, decks.get(x.apt.id)).overlapped;
          for (const a of placed) {
            for (const b of placed) {
              if (a === b || a.cluster !== b.cluster || !beside(a) || !beside(b)) continue;
              const timeOverlap = a.startMin < b.endMin && b.startMin < a.endMin;
              const colOverlap =
                a.colIndex < b.colIndex + b.colSpan && b.colIndex < a.colIndex + a.colSpan;
              assert.ok(!(timeOverlap && colOverlap), "пересекающиеся записи налезли друг на друга");
            }
          }
        }
      }
    }
  });
});
