import { blockFrame, type BlockFrame, type PlacedAppt } from "@/features/calendar/layout";
import { blockLadder, rowsThatFit, textOverflows } from "@/features/calendar/block-geometry";
import { blockMoney, type BlockMoney } from "@/features/calendar/block-status";
import { GAP, MIN_H } from "@/features/calendar/grid-units";

/** Everything the block draws that is plain arithmetic of its size. */
export type BlockLayout = {
  winStart: number;
  winEnd: number;
  totalMin: number;
  visStart: number;
  visEnd: number;
  frame: BlockFrame;
  left: number;
  width: number;
  cancelled: boolean;
  completed: boolean;
  cardH: number;
  pad: number;
  bw: number;
  markSize: number;
  textW: number;
  topHandle: number;
  bottomHandle: number;
  rowsFit: number;
  /** Деньги записи для значка внизу; `null` — платить нечего. */
  money: BlockMoney;
  timeText: string;
  showTime: boolean;
  showService: boolean;
  /** Строки (0 имя, 1 время, 2 услуга), чей край тает: не влезают. */
  fadeRows: number[];
  lastRow: ReturnType<typeof blockLadder>["lastRow"];
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
  offLabelColor,
  overdue,
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
  offLabelColor: string | null;
  editing: boolean;
  /** Не закрыта в срок — время жирное, и шире. */
  overdue: boolean;
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
  // МЕСТО В КОЛОНКЕ — `blockFrame` (layout.ts, под тестом): записи на одно
  // время делят колонку дорожками, поздно начавшаяся в узкой — «веером».
  const frame = blockFrame(placed, laneW, GAP);
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
  // Половинка колонки Недели (~22pt) — паддинг 2: каждая точка там — лишняя
  // буква имени.
  const pad = width >= 96 ? 6 : width >= 60 ? 4 : width >= 30 ? 3 : 2;
  // ТОЛЩИНА — ВЕСЬ СИГНАЛ ПРОСРОЧКИ, И ЭТО ЕДИНСТВЕННЫЙ КАНАЛ, КОТОРЫЙ
  // УСИЛИВАЕТСЯ ПРИ СУЖЕНИИ. Кант 1 → 2pt меняет долю канта в площади плитки:
  // 21pt (две наложенные записи в Неделе) 13.6 % → 26.4 %, неделя 46pt
  // 8.7 % → 17.0 %, день 330pt 5.1 % → 10.2 %. То есть канал работает ровно
  // там, где знака нет (markSize 0 при ширине < 40), и слабеет там, где есть
  // текст. Геометрия не меняется ни при дейтеранопии, ни при перекраске
  // палитры владельцем — в отличие от любого оттенка.
  // КОНТУР 1.5pt У КАЖДОГО БЛОКА: свой же цвет на полтона
  // глубже отделяет соседние записи и даёт плотной заливке край — не тёмная
  // рамка (ядовито чёрная окантовка недопустима). Толстого чёрного
  // канта просрочки нет (некрасиво) — незакрытая
  // запись говорит жирным временем.
  const bw = 1.5;
  // Гейт точки чужой метки: в колонке уже 40pt ей места нет.
  const markSize = width >= 40 ? 8 : 0;
  // УГЛОВОГО ЗНАКА «ВЫПОЛНЕНО» НЕТ: в колонке недели галка не помещалась, и
  // оставалась немая полупрозрачная точка, похожая на случайную. «Выполнено»
  // живёт в строке значков внизу — галкой, рядом с оплатой.
  // Внутренняя ширина НЕ зависит от толщины канта: компенсация паддинга ниже
  // (`pad - (bw - 1)`) гасит лишний кант ровно, поэтому вычитаем 2, а не 2·bw.
  const textW = width - 2 * pad - 2;
  // ЧЕСТНЫЙ СЧЁТЧИК СТРОК. Обвязка карточки постоянна и равна 6pt: кант сверху
  // и снизу плюс вертикальный паддинг (при bw 1 это 2+4, при bw 2 — 4+2).
  // Значит n строк ФИЗИЧЕСКИ помещаются при cardH ≥ 6 + n·lineH.
  // РУЧКА РАСТЯЖКИ СВЕРХУ — НЕ ПОВЕРХ ИМЕНИ. В «Свободном перемещении» верхняя ручка (top 3, высота 4)
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
  // ЛЕСТНИЦА — ЧИСТОЙ ФУНКЦИЕЙ ПОД ТЕСТОМ (`blockLadder`): имя, время,
  // услуга — сколько влезает. Адреса на блоке нет: имени, времени и услуги
  // хватает, чтобы узнать визит. Деньги записи остаются для озвучки — глазу
  // их говорит цвет блока.
  const money = blockMoney(apt);
  const ladder = blockLadder({ rowsFit, hasService: !!service });
  const { showService, lastRow } = ladder;
  // ТОЧКУ ЧУЖОЙ МЕТКИ ОБХОДИТ ПОСЛЕДНЯЯ СТРОКА, КАКОЙ БЫ ОНА НИ БЫЛА. Точка
  // лежит абсолютно в правом нижнем углу; раньше отступ был вшит только в
  // адрес, и на карточке, где последней осталась услуга (или время), её хвост
  // заезжал под точку.
  const dotReserve =
    offLabelColor && markSize > 0 && cardH >= (completed ? 30 : 20) ? 12 : 0;
  // Строки, чей край тает: только те, что не влезают. Плёнка по всей кромке
  // гасила бы и короткое время «10:00» в узкой колонке недели.
  const timeText = textW >= 92 ? `${apt.time_start} – ${apt.time_end}` : apt.time_start;
  const fadeRows: number[] = [];
  if (!cancelled && textW >= 24) {
    const nameW = textW - (lastRow === "name" ? dotReserve : 0);
    if (textOverflows(label, nameW, { bold: true })) fadeRows.push(0);
    if (
      ladder.showTime &&
      textOverflows(timeText, textW - (lastRow === "time" ? dotReserve : 0), { bold: overdue })
    )
      fadeRows.push(1);
    if (showService && service && textOverflows(service, textW - (lastRow === "service" ? dotReserve : 0)))
      fadeRows.push(2);
  }
  return {
    winStart,
    winEnd,
    totalMin,
    visStart,
    visEnd,
    frame,
    left,
    width,
    cancelled,
    completed,
    cardH,
    pad,
    bw,
    markSize,
    textW,
    topHandle,
    bottomHandle,
    rowsFit,
    money,
    timeText,
    showTime: ladder.showTime,
    showService,
    fadeRows,
    lastRow,
    dotReserve,
  };
}
