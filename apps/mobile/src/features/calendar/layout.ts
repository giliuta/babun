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
/** Уже этого блок «рядом» не ставится — только «веером» поверх. */
export const MIN_BESIDE_W = 6;
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
 *  сплетаться).
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
    // Сдвиг на всю стопку — не больше 40 % колонки, как у «веера»:
    // при 4pt на запись четырнадцать записей в одну минуту в колонке
    // Недели давали отрицательную ширину, и верхняя карточка пропадала.
    const peek = Math.min(4, (laneW * 0.4) / (deck.size - 1));
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

export type Deck = { index: number; size: number; members: PlacedAppt[] };

const touched = (p: PlacedAppt): number => {
  const at = Date.parse(p.apt.updated_at ?? "");
  return Number.isFinite(at) ? at : 0;
};

const isWork = (p: PlacedAppt): boolean =>
  (p.apt.kind ?? "work") === "work" && p.apt.status !== "cancelled";

/** НАКЛАДКА — ДВЕ РАБОЧИЕ ЗАПИСИ НА ОДНО ВРЕМЯ. Для каждой такой записи —
 *  сколько других рабочих записей идёт одновременно с ней. События и
 *  отменённые накладкой не считаются: так же решает `findOverlap`. */
export function clashCounts(placements: readonly PlacedAppt[]): Map<string, number> {
  const out = new Map<string, number>();
  const work = placements.filter(isWork);
  for (const p of work) {
    let n = 0;
    for (const q of work) {
      if (q !== p && p.startMin < q.endMin && q.startMin < p.endMin) n += 1;
    }
    if (n > 0) out.set(p.apt.id, n);
  }
  return out;
}

/** СТОПКИ УЗКОЙ КОЛОНКИ. Две полоски по 24pt без текста не читаются никак, поэтому в
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
    // НАВЕРХ — ПОСЛЕДНЯЯ ТРОНУТАЯ. Перенесённая на занятое время короче
    // соседки уходила ПОД неё, и перенос выглядел откатом: запись пропадала
    // с того места, куда её только что положили. При равенстве — самая
    // длинная: у неё есть высота под имя и «+N»; короткие под ней видны краем.
    members.sort(
      (a, b) =>
        touched(a) - touched(b) ||
        a.endMin - a.startMin - (b.endMin - b.startMin) ||
        a.startMin - b.startMin,
    );
    members.forEach((p, index) =>
      out.set(p.apt.id, { index, size: members.length, members }),
    );
  }
  return out;
}

/** КТО НЕСЁТ ЗНАЧОК НАКЛАДКИ. Значок один на группу — на карточке, что лежит
 *  сверху: в стопке это верхняя (её «+N» становится красным), вне стопки —
 *  та, что поверх соседок (правее в «веере», последняя в ряду в Дне). Число —
 *  сколько записей под значком: у стопки весь её состав, иначе накладки. */
export function clashBadgeHolders(
  placements: readonly PlacedAppt[],
  decks: ReadonlyMap<string, Deck>,
): Map<string, number> {
  const clash = clashCounts(placements);
  const out = new Map<string, number>();
  for (const deck of new Set(decks.values())) {
    if (!deck.members.some((m) => clash.has(m.apt.id))) continue;
    const top = deck.members[deck.size - 1];
    out.set(top.apt.id, deck.size - 1);
  }
  const work = placements.filter(isWork);
  for (const p of work) {
    if (!clash.has(p.apt.id) || decks.has(p.apt.id)) continue;
    const covers = work.every(
      (q) =>
        q === p ||
        !(p.startMin < q.endMin && q.startMin < p.endMin) ||
        decks.has(q.apt.id) ||
        q.colIndex < p.colIndex,
    );
    if (covers) out.set(p.apt.id, clash.get(p.apt.id) ?? 0);
  }
  return out;
}
