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
const LATE_START_MIN = 30;

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
/** Уже этого блок «рядом» не ставится — только «веером» поверх. */
const MIN_BESIDE_W = 6;
/** Ширина верхней карточки «веера», при которой на ней читается имя. */
export const FAN_TOP_MIN_W = 36;
/** Полоса нижней карточки «веера» — не уже этого: цвет соседки виден. */
export const FAN_STRIP_MIN_W = 8;

export type BlockFrame = {
  left: number;
  width: number;
  /** Порядок наложения: в «веере» следующая запись лежит поверх. */
  z: number;
  /** Блок лежит поверх соседа — нужен вырез по краю. */
  overlapped: boolean;
};

/** МЕСТО БЛОКА В КОЛОНКЕ (несколько записей на одно время не должны
 *  сплетаться). `p` — уже уложенная в дорожки (`fitLanes`).
 *  • Рядом: колонка делится поровну, с растяжкой вправо на свободное.
 *  • Узкая (Неделя), запись началась заметно позже соседки: «веер» — лежит
 *    поверх со сдвигом, начавшаяся раньше видна полосой слева и целиком
 *    выше чужого начала. */
export function blockFrame(p: PlacedAppt, laneW: number, gap: number): BlockFrame {
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
  // только спрятал бы одну под другой. Но не уже `MIN_BESIDE_W`:
  // двадцать записей на одно время делили колонку до нуля и ниже —
  // блок пропадал. Тогда — веер: поверх соседей, но видимый.
  if ((laneW >= SIDE_BY_SIDE_MIN_W || !p.late) && beside.width >= MIN_BESIDE_W) {
    return beside;
  }
  // «Веер»: начавшаяся позже ложится поверх со сдвигом, почти во всю
  // ширину; верх соседки с её именем открыт целиком.
  // ВЕРХНЕЙ ОСТАЁТСЯ МЕСТО ПОД ИМЯ. При сдвиге 40 % колонки Недели (~50pt)
  // верхняя карточка сужалась до ~27pt: имя не помещалось ни у одной из
  // двух записей, и накладка читалась как два безымянных бруска. Полосе
  // соседки хватает цвета — её имя и так видно выше чужого начала.
  const roomForTop = (laneW - gap - FAN_TOP_MIN_W) / (p.colCount - 1);
  const step = Math.min(22, (laneW * 0.4) / (p.colCount - 1), Math.max(FAN_STRIP_MIN_W, roomForTop));
  return {
    left: 1 + p.colIndex * step,
    width: laneW - gap - p.colIndex * step,
    z: p.colIndex,
    overlapped: true,
  };
}

/** Читаемый минимум ширины записи, поставленной рядом с другими. На 64pt
 *  карточка получает паддинг 4 и ~51pt под текст: время «10:00» (≈34pt) и
 *  имя в пять-шесть букв 13-м жирным помещаются целиком. Уже — имя
 *  обрывается на втором-третьем знаке, и дорожка перестаёт называть запись.
 *  В Дне iPhone (~350pt) это пять дорожек: четыре записи на одно время стоят
 *  рядом по ~88pt, пять — по ~70pt, с шестой последняя дорожка становится
 *  «+N». */
export const MIN_LANE_W = 64;

/** Сколько дорожек вмещает колонка: не меньше двух — в Неделе (~50pt) две
 *  записи на одно время делят её пополам, как в Bumpix. */
export function lanesFor(laneW: number): number {
  return Math.max(2, Math.floor(laneW / MIN_LANE_W));
}

/** Карточка «+N» последней дорожки: записи, которым места рядом не хватило. */
export type MoreCard = {
  key: string;
  startMin: number;
  endMin: number;
  colIndex: number;
  colCount: number;
  /** По началу; тап раскрывает их списком. */
  members: PlacedAppt[];
};

const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) =>
  a.startMin < b.endMin && b.startMin < a.endMin;

/** Дорожки переполненной кучки заново: при равном начале первой идёт
 *  длинная. `layoutDay` ставит первой короткую — в Дне это даёт растяжку
 *  вправо, но здесь первая дорожка пустела бы посреди времени, а длинная
 *  запись пряталась бы в «+N» на весь свой срок. Сколько дорожек нужно, от
 *  порядка равных начал не зависит. */
function longFirst(members: readonly PlacedAppt[]): PlacedAppt[] {
  const sorted = [...members].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const colEnds: number[] = [];
  const cols = sorted.map((it) => {
    let col = colEnds.findIndex((e) => e <= it.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.endMin);
    } else {
      colEnds[col] = it.endMin;
    }
    return col;
  });
  return sorted.map((it, i) => ({
    ...it,
    colIndex: cols[i],
    late: sorted.some(
      (other, j) => cols[j] < cols[i] && overlaps(it, other) && other.startMin <= it.startMin - LATE_START_MIN,
    ),
  }));
}

/** ЗАПИСИ НА ОДНО ВРЕМЯ — ДОРОЖКАМИ, ЛИШНИЕ — «+N» (владелец, «как в Bumpix»).
 *  Кучка, которой хватает дорожек (`lanesFor`), стоит как разложена: каждая
 *  запись своей долей колонки. Кучка шире — первые дорожки отдаются первым
 *  записям, а последняя — карточке «+N» того же вида: сколько записей не
 *  поместилось на это время. Одинокая лишняя запись карточкой не
 *  становится: «+1» занял бы то же место, что сама запись.
 *  `pinnedId` — запись в свободном перемещении: её тянут пальцем, и в «+N» она
 *  не прячется, а встаёт в последнюю дорожку. */
export function fitLanes(
  placements: readonly PlacedAppt[],
  laneW: number,
  pinnedId: string | null = null,
): { shown: PlacedAppt[]; more: MoreCard[] } {
  const lanes = lanesFor(laneW);
  const shown: PlacedAppt[] = [];
  const more: MoreCard[] = [];
  const byCluster = new Map<number, PlacedAppt[]>();
  for (const p of placements) {
    const list = byCluster.get(p.cluster) ?? [];
    list.push(p);
    byCluster.set(p.cluster, list);
  }
  for (const [cluster, members] of byCluster) {
    if (members[0].colCount <= lanes) {
      shown.push(...members);
      continue;
    }
    const last = lanes - 1;
    const laid = longFirst(members);
    const keep = laid.filter((p) => p.colIndex < last);
    const rest = laid
      .filter((p) => p.colIndex >= last)
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    // Лишние, идущие одновременно, — одна карточка на их общее время.
    const groups: PlacedAppt[][] = [];
    let groupEnd = -1;
    for (const p of rest) {
      if (groups.length > 0 && p.startMin < groupEnd) groups[groups.length - 1].push(p);
      else groups.push([p]);
      groupEnd = Math.max(groupEnd, p.endMin);
    }
    const inLast: PlacedAppt[] = [];
    groups.forEach((group, i) => {
      const pinned = group.find((p) => p.apt.id === pinnedId);
      if (pinned) inLast.push(pinned);
      const hidden = group.filter((p) => p !== pinned);
      if (hidden.length === 1 && !pinned) {
        inLast.push(hidden[0]);
      } else if (hidden.length > 0) {
        more.push({
          key: `more:${cluster}:${i}`,
          startMin: Math.min(...hidden.map((p) => p.startMin)),
          endMin: Math.max(...hidden.map((p) => p.endMin)),
          colIndex: last,
          colCount: lanes,
          members: hidden,
        });
      }
    });
    const lastLane = [...inLast, ...more.filter((m) => m.key.startsWith(`more:${cluster}:`))];
    for (const p of keep) {
      // Растяжка вправо — пока в дорожке справа никто не идёт одновременно.
      let span = 1;
      for (let c = p.colIndex + 1; c < lanes; c++) {
        const taken =
          c === last
            ? lastLane.some((q) => overlaps(p, q))
            : keep.some((q) => q !== p && q.colIndex === c && overlaps(p, q));
        if (taken) break;
        span++;
      }
      shown.push({ ...p, colCount: lanes, colSpan: span });
    }
    for (const p of inLast) shown.push({ ...p, colIndex: last, colCount: lanes, colSpan: 1 });
  }
  return { shown, more };
}

/** Место карточки «+N» — её дорожка, как у записи рядом. */
export function moreFrame(card: MoreCard, laneW: number, gap: number): BlockFrame {
  const colW = laneW / card.colCount;
  return { left: card.colIndex * colW + 1, width: colW - gap, z: card.colIndex, overlapped: false };
}
