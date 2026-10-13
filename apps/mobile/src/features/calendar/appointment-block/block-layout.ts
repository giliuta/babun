import { blockFrame, type BlockFrame, type PlacedAppt } from "@/features/calendar/layout";
import { blockLadder, rowsThatFit } from "@/features/calendar/block-geometry";
import { GAP, MIN_H } from "@/features/calendar/grid-units";

/** Everything the block draws that is plain arithmetic of its size. */
export type BlockLayout = {
  winStart: number;
  winEnd: number;
  totalMin: number;
  visStart: number;
  visEnd: number;
  frame: BlockFrame;
  deckMore: number;
  deckBadgeW: number;
  left: number;
  width: number;
  cancelled: boolean;
  completed: boolean;
  cardH: number;
  pad: number;
  bw: number;
  markSize: number;
  markReserve: number;
  textW: number;
  topHandle: number;
  bottomHandle: number;
  rowsFit: number;
  nameParts: string[];
  showTime: boolean;
  showService: boolean;
  showAddress: boolean;
  lastRow: ReturnType<typeof blockLadder>["lastRow"];
  deckBadgeLow: boolean;
  nameLineW: number;
  dotReserve: number;
};

export function blockLayout({
  placed,
  laneW,
  startHour,
  endHour,
  hourH,
  lineH,
  label,
  service,
  address,
  offLabelColor,
  deckIndex,
  deckSize,
  editing,
  reschedulable,
}: {
  placed: PlacedAppt;
  laneW: number;
  startHour: number;
  endHour: number;
  hourH: number;
  lineH: number;
  label: string;
  service: string | null;
  address: string | null;
  offLabelColor: string | null;
  deckIndex?: number;
  deckSize?: number;
  editing: boolean;
  /** The block has a reschedule handler (not crew read-only). */
  reschedulable: boolean;
}): BlockLayout {
  const { apt, startMin, endMin } = placed;
  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const totalMin = winEnd - winStart;
  // Clamp into the visible window (web windowStart/windowEnd semantics):
  // a block starting before the window pins to the top instead of getting
  // a negative top and vanishing above the grid.
  const visStart = Math.max(startMin, winStart);
  const visEnd = Math.min(endMin, winEnd);
  // МЕСТО В КОЛОНКЕ — `blockFrame` (layout.ts, под тестом): в Дне записи
  // рядом с растяжкой вправо, в узкой Неделе — «веером» поверх друг друга.
  const frame = blockFrame(
    placed,
    laneW,
    GAP,
    deckSize && deckSize > 1 ? { index: deckIndex ?? 0, size: deckSize } : undefined,
  );
  // Верхняя карточка стопки несёт «+N» — сколько записей под ней.
  const deckMore =
    deckSize && deckSize > 1 && deckIndex === deckSize - 1 ? deckSize - 1 : 0;
  const deckBadgeW = deckMore > 0 ? 20 : 0;
  const { left, width } = frame;
  const cancelled = apt.status === "cancelled";
  const completed = apt.status === "completed";
  // ═══ ГЕОМЕТРИЯ И ЦВЕТ БЛОКА ═══
  // Всё считается арифметикой от ширины и высоты, а не флагом «компактный»:
  // блок недели и блок дня — один и тот же блок при разной ширине.
  const cardH = Math.max(MIN_H(lineH), ((visEnd - visStart) / 60) * hourH) - 2;
  // Третья ступень паддинга (3pt) в колонке недели уже 60pt — как у чипов
  // «весь день» (`chipPad`): имя из шести букв («Андрей») влезает целиком,
  // а не обрывается на «Андре».
  const pad = width >= 96 ? 6 : width >= 60 ? 4 : 3;
  // ТОЛЩИНА — ВЕСЬ СИГНАЛ ПРОСРОЧКИ, И ЭТО ЕДИНСТВЕННЫЙ КАНАЛ, КОТОРЫЙ
  // УСИЛИВАЕТСЯ ПРИ СУЖЕНИИ. Кант 1 → 2pt меняет долю канта в площади плитки:
  // 21pt (две наложенные записи в Неделе) 13.6 % → 26.4 %, неделя 46pt
  // 8.7 % → 17.0 %, день 330pt 5.1 % → 10.2 %. То есть канал работает ровно
  // там, где знака нет (markSize 0 при ширине < 40), и слабеет там, где есть
  // текст. Геометрия не меняется ни при дейтеранопии, ни при перекраске
  // палитры владельцем — в отличие от любого оттенка.
  // КОНТУР 1.5pt У КАЖДОГО БЛОКА (владелец 2026-09-24, вариант 3 второй
  // итерации: «контур добавить, насыщенность»): свой же цвет на полтона
  // глубже отделяет соседние записи и даёт плотной заливке край — не тёмная
  // рамка (владелец 04.10: «ядовито чёрная окантовка»). Толстого чёрного
  // канта просрочки нет (владелец 2026-10-01: «некрасиво») — незакрытая
  // запись говорит жирным временем.
  const bw = 1.5;
  const markSize = width >= 96 ? 14 : width >= 40 ? 8 : 0;
  // Место под знак резервирует ТОЛЬКО выполненная: у просрочки знака нет.
  // Пока его резервировала и она, просроченный блок недели на экране 393pt
  // давал textW 22.3 при гейте 24 — то есть был НЕМЫМ, без имени клиента.
  const markReserve = markSize > 0 && completed ? markSize + 4 : 0;
  // Внутренняя ширина НЕ зависит от толщины канта: компенсация паддинга ниже
  // (`pad - (bw - 1)`) гасит лишний кант ровно, поэтому вычитаем 2, а не 2·bw.
  const textW = width - 2 * pad - 2 - markReserve;
  // ЧЕСТНЫЙ СЧЁТЧИК СТРОК. Обвязка карточки постоянна и равна 6pt: кант сверху
  // и снизу плюс вертикальный паддинг (при bw 1 это 2+4, при bw 2 — 4+2).
  // Значит n строк ФИЗИЧЕСКИ помещаются при cardH ≥ 6 + n·lineH.
  // РУЧКА РАСТЯЖКИ СВЕРХУ — НЕ ПОВЕРХ ИМЕНИ (повторный аудит 03.10, на
  // симуляторе). В «Свободном перемещении» верхняя ручка (top 3, высота 4)
  // ложилась белой полосой прямо на первую строку — имя читалось
  // перечёркнутым. Пока ручка видна, текст отступает под неё, а строк
  // считается на столько меньше — и с нижней ручкой тоже: иначе сдвинутая
  // вниз последняя строка ложилась уже под нижнюю.
  const resizable = editing && reschedulable && apt.status !== "cancelled";
  const topHandle = resizable && cardH >= 40 ? 6 : 0;
  const bottomHandle = resizable && cardH >= 24 ? 6 : 0;
  const rowsFit = rowsThatFit(cardH - topHandle - bottomHandle, lineH);
  // СТРОКА ЛИБО НАРИСОВАНА ЦЕЛИКОМ, ЛИБО ЕЁ НЕТ. Прежняя формула
  // `floor((cardH − 9) / lineH) + 1` пускала строку, когда до неё не хватало
  // почти целой: получасовая запись при обычном зуме (высота 28) получала две
  // строки на место под одну, и время рисовалось разрезанным пополам обрезкой
  // карточки. Половина цифры хуже отсутствующей цифры, а время у записи и без
  // того названо рельсом слева и позицией блока — потому имя и стоит первым.
  // Единица снизу остаётся: у самого низкого блока имя пытается напечататься
  // всегда, как было.
  // ЛЕСТНИЦА — ЧИСТОЙ ФУНКЦИЕЙ ПОД ТЕСТОМ (`blockLadder`): имя (в узком блоке
  // — имя и фамилия двумя строками), время, услуга, адрес — сколько влезает.
  // Потолка в три строки и гейта ширины 120pt у услуги с адресом больше нет:
  // владелец хочет, чтобы в блок «больше влазило».
  const nameWords = label.trim().split(/\s+/);
  const ladder = blockLadder({
    rowsFit,
    textW,
    nameWords: nameWords.length,
    hasService: !!service,
    hasAddress: !!address,
  });
  const nameParts =
    ladder.nameRows === 2
      ? [nameWords[0], nameWords.slice(1).join(" ")]
      : [label];
  const { showService, showAddress, lastRow } = ladder;
  // ТОЧКУ ЧУЖОЙ МЕТКИ ОБХОДИТ ПОСЛЕДНЯЯ СТРОКА, КАКОЙ БЫ ОНА НИ БЫЛА. Точка
  // лежит абсолютно в правом нижнем углу; раньше отступ был вшит только в
  // адрес, и на карточке, где последней осталась услуга (или время), её хвост
  // заезжал под точку.
  // «+N» стопки: внизу, если под именем есть ещё строка; иначе сверху, и
  // тогда имя отступает на ширину значка.
  const deckBadgeLow = deckMore > 0 && rowsFit >= 2;
  // ШИРИНА ПЕРВОЙ СТРОКИ ИМЕНИ — после значка «+N» сверху. Значок резервировался
  // уже ПОСЛЕ гейта 24pt: у верхней карточки стопки в Неделе (две короткие
  // записи в одно время) имени оставалось ~14pt — «А…» (повторный аудит
  // 03.10). Гейт меряет то, что останется имени на самом деле.
  const nameLineW =
    textW + markReserve - Math.max(markReserve, deckMore > 0 && !deckBadgeLow ? deckBadgeW : 0);
  const dotReserve =
    offLabelColor && markSize > 0 && cardH >= (completed ? 30 : 20) ? 12 : 0;
  return {
    winStart,
    winEnd,
    totalMin,
    visStart,
    visEnd,
    frame,
    deckMore,
    deckBadgeW,
    left,
    width,
    cancelled,
    completed,
    cardH,
    pad,
    bw,
    markSize,
    markReserve,
    textW,
    topHandle,
    bottomHandle,
    rowsFit,
    nameParts,
    showTime: ladder.showTime,
    showService,
    showAddress,
    lastRow,
    deckBadgeLow,
    nameLineW,
    dotReserve,
  };
}
