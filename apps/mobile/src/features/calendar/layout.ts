import type { Appointment } from "@babun/shared/local/appointments";

export type PlacedAppt = {
  apt: Appointment;
  startMin: number;
  endMin: number;
  colIndex: number;
  colCount: number;
  /** Сколько колонок блок занимает вправо: соседние колонки, свободные на
   *  всё его время, отдаются ему (≥ 1). */
  colSpan: number;
  /** Блок начинается заметно позже соседа слева, с которым пересекается:
   *  в узкой колонке его кладут «веером» поверх, а не делят ширину. */
  late: boolean;
  /** Номер кучки взаимно пересекающихся записей внутри дня. */
  cluster: number;
};

/** С какой разницы начал запись считается «начавшейся позже». */
export const LATE_START_MIN = 30;

export const toMin = (hm: string): number => {
  const [h, m] = (hm ?? "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Assign each appointment a column so mutually-overlapping ones sit
// side-by-side instead of stacking full-width. Standard interval-graph
// approach: split into clusters of transitively-overlapping events, then
// greedily pack each cluster into the fewest columns; every block in a
// cluster shares that cluster's column count (equal widths, like the web grid).
export function layoutDay(appts: Appointment[]): PlacedAppt[] {
  const items = appts
    .map((apt) => {
      const startMin = toMin(apt.time_start);
      const endMin = Math.max(toMin(apt.time_end), startMin + 15);
      return { apt, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: PlacedAppt[] = [];
  let clusterNo = 0;
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = []; // running end-time per column
    const cols: number[] = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((e) => e <= it.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.endMin);
      } else {
        colEnds[col] = it.endMin;
      }
      cols.push(col);
    }
    const colCount = colEnds.length;
    // РАСТЯЖКА ВПРАВО: блок забирает следующие колонки, пока в них никто не
    // пересекается с ним по времени. Короткая запись рядом с длинной больше
    // не остаётся полоской в треть ширины, когда справа пусто.
    const overlaps = (a: (typeof cluster)[number], b: (typeof cluster)[number]) =>
      a.startMin < b.endMin && b.startMin < a.endMin;
    cluster.forEach((it, i) => {
      let span = 1;
      for (let c = cols[i] + 1; c < colCount; c++) {
        const blocked = cluster.some((other, j) => cols[j] === c && overlaps(it, other));
        if (blocked) break;
        span++;
      }
      const late = cluster.some(
        (other, j) =>
          cols[j] < cols[i] &&
          overlaps(it, other) &&
          other.startMin <= it.startMin - LATE_START_MIN,
      );
      out.push({
        apt: it.apt,
        startMin: it.startMin,
        endMin: it.endMin,
        colIndex: cols[i],
        colCount,
        colSpan: span,
        late,
        cluster: clusterNo,
      });
    });
    clusterNo++;
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

/** Ширина колонки, начиная с которой пересекающиеся записи ставятся рядом;
 *  уже — «веером» (колонка Недели ~50pt не вмещает и двух имён рядом). */
export const SIDE_BY_SIDE_MIN_W = 140;

export type BlockFrame = {
  left: number;
  width: number;
  /** Порядок наложения: в «веере» следующая запись лежит поверх. */
  z: number;
  /** Блок лежит поверх соседа — нужен вырез по краю. */
  overlapped: boolean;
};

/** МЕСТО БЛОКА В КОЛОНКЕ (владелец 24.09: «когда несколько записей на одно
 *  время, они сплетаются — сделать в правильном дизайне»).
 *  • Широкая колонка (День): рядом, с растяжкой вправо на свободное.
 *  • Узкая (Неделя): «веер» — каждая следующая сдвинута на шаг и лежит
 *    поверх; начавшаяся раньше видна полосой слева и целиком выше чужого
 *    начала. Шаг — 40 % колонки на весь веер, не больше 22pt на запись. */
export function blockFrame(
  p: PlacedAppt,
  laneW: number,
  gap: number,
  deck?: { index: number; size: number },
): BlockFrame {
  // СТОПКА: в узкой колонке записи, начавшиеся почти вместе, лежат друг на
  // друге со сдвигом 4pt — верхняя почти во всю ширину, с именем и «+N».
  if (deck && deck.size > 1) {
    const peek = 4;
    return {
      left: 1 + deck.index * peek,
      width: laneW - gap - (deck.size - 1) * peek,
      z: deck.index,
      overlapped: deck.index > 0,
    };
  }
  if (p.colCount <= 1) {
    return { left: 1, width: laneW - gap, z: 0, overlapped: false };
  }
  const colW = laneW / p.colCount;
  const beside: BlockFrame = {
    left: p.colIndex * colW + 1,
    width: colW * p.colSpan - gap,
    z: p.colIndex,
    overlapped: false,
  };
  // Широкая колонка или записи начались почти вместе — рядом: веер тут
  // только спрятал бы одну под другой.
  if (laneW >= SIDE_BY_SIDE_MIN_W || !p.late) return beside;
  // «Веер»: начавшаяся позже ложится поверх со сдвигом, почти во всю
  // ширину; верх соседки с её именем открыт целиком.
  const step = Math.min(22, (laneW * 0.4) / (p.colCount - 1));
  return {
    left: 1 + p.colIndex * step,
    width: laneW - gap - p.colIndex * step,
    z: p.colIndex,
    overlapped: true,
  };
}

export type Deck = { index: number; size: number; members: PlacedAppt[] };

/** СТОПКИ УЗКОЙ КОЛОНКИ (владелец 24.09: «несколько записей на одно время —
 *  сплетаются»). Две полоски по 24pt без текста не читаются никак, поэтому в
 *  колонке уже `SIDE_BY_SIDE_MIN_W` записи одной кучки, начавшиеся почти
 *  вместе (не `late`), складываются в стопку. Поздние остаются «веером». */
export function decksFor(placements: PlacedAppt[], laneW: number): Map<string, Deck> {
  const out = new Map<string, Deck>();
  if (laneW >= SIDE_BY_SIDE_MIN_W) return out;
  const byCluster = new Map<number, PlacedAppt[]>();
  for (const p of placements) {
    if (p.colCount <= 1 || p.late) continue;
    const list = byCluster.get(p.cluster) ?? [];
    list.push(p);
    byCluster.set(p.cluster, list);
  }
  for (const members of byCluster.values()) {
    if (members.length < 2) continue;
    // Наверх — самая длинная: у неё есть высота под имя и «+N»; короткие
    // под ней видны краем.
    members.sort((a, b) => a.endMin - a.startMin - (b.endMin - b.startMin) || a.startMin - b.startMin);
    members.forEach((p, index) =>
      out.set(p.apt.id, { index, size: members.length, members }),
    );
  }
  return out;
}
