import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { useThemeColors } from "@/theme/colors";
import {
  CANCELLED_BORDER,
  CANCELLED_EDGE,
  useBlockColors,
} from "@/features/calendar/status-colors";
import {
  chipOverflowW,
  chipPad,
  chipTextW,
  chipsThatFit,
  CHIP_GAP,
  TEXT_MIN_W,
} from "@/features/calendar/block-geometry";
import { BLOCK_TEXT, fillRgba } from "@/components/ui/color-contrast";
import { MIN_H } from "@/features/calendar/grid-units";

// ═══ СОБЫТИЯ «ВЕСЬ ДЕНЬ» — ЧИПЫ В ЗАКРЕПЛЁННОЙ ПОЛОСЕ НАД СЕТКОЙ ═══
//
// Событие «весь день» — это ЗАПИСЬ (у неё статус, меню, отмена), но у неё нет
// «своей» высоты на оси времени: она либо врёт про час, либо закрывает сутки.
// Единственное честное место — полоса НАД осью, и так делают все календари.
//
// Вертикальные полоски 8pt у левой кромки колонки — корешок, которого в
// продукте нет: у полоски не было бы ни имени, ни намёка на него, и она
// отжимала бы таймированные блоки вправо.
//
// Внутрь колонки чип класть нельзя технически: вся геометрия `DayColumn` —
// проценты от анимируемой высоты, и узел фиксированной высоты ломает инвариант,
// пересчитывая layout на каждом кадре щипка.
export const allDayOf = (appts: readonly Appointment[]): Appointment[] =>
  appts.filter((a) => a.event_all_day === true);

export const hasAllDay = (appts: readonly Appointment[]): boolean =>
  appts.some((a) => a.event_all_day === true);

/** Высота полосы: минимальный блок продукта в одну строку плюс дыхание, но не
 *  меньше 36pt. Тридцать шесть — не про текст, а про ПАЛЕЦ: чип с запасом
 *  касания 4pt даёт мишень 44pt, как требует закон продукта. Растить дальше
 *  нельзя — полоса стоит между шапкой и сеткой и каждую точку отнимает у
 *  первого видимого часа. */
export function useAllDayBandH(): number {
  const { fontScale } = useWindowDimensions();
  return Math.max(36, MIN_H(Math.ceil(16 * Math.min(fontScale, 1.3))) + 4);
}

export function AllDayRow({
  appointments,
  clientName,
  teamColorFor,
  onEdit,
  onMenu,
  onOverflow,
}: {
  /** УЖЕ отфильтрованные события «весь день» этого дня (`allDayOf`). */
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  teamColorFor?: (a: Appointment) => string | null;
  onEdit: (a: Appointment) => void;
  onMenu?: (a: Appointment) => void;
  /** Куда ведёт «+N». БЕЗ ЭТОГО ПРОПА СПРЯТАННЫЕ СОБЫТИЯ НЕДОСТИЖИМЫ: в
   *  колонке недели помещается ровно один чип, и второй отпуск открыть было бы
   *  нечем — прежние полоски хотя бы все были кликабельны. Неделя передаёт сюда
   *  «открыть этот день»: в Дне колонка вмещает девять чипов. */
  onOverflow?: () => void;
}) {
  const t = useThemeColors();
  const blockColors = useBlockColors(teamColorFor);
  const { fontScale } = useWindowDimensions();
  const lineH = Math.ceil(16 * Math.min(fontScale, 1.3));
  const [cellW, setCellW] = useState(0);

  // ПРАВИЛО ОСТАНОВКИ. Чипы делят ширину поровну, но их число ограничено снизу
  // читаемой шириной: в колонке недели (~49pt) помещается РОВНО ОДИН чип, и
  // пять отпусков пяти мастеров дают один чип с именем и счётчиком «+4», а не
  // пять безымянных плашек по 7pt.
  //
  // РЕЗЕРВ ПОД «+N» УЧИТЫВАЕТСЯ ДО РЕШЕНИЯ, А НЕ ПОСЛЕ. Это ровно та ошибка,
  // которую продукт уже ловил у блока записи: там `markReserve` вычитался из
  // ширины ПОСЛЕ того, как решено «имя влезает», и просроченный блок недели
  // оставался немым. Здесь она повторялась в чипе: у последнего чипа со
  // счётчиком отнимается ещё и резерв, а гейт числа чипов об этом не знал.
  const shown = chipsThatFit(cellW, appointments.length);
  const overflow = appointments.length - shown;
  const chipW = shown > 0 ? (cellW - CHIP_GAP * (shown - 1)) / shown : 0;

  return (
    <View
      // Линия сетки слева — та же, что у колонки: полоса читается продолжением
      // сетки, а не отдельной плитой.
      onLayout={(e) => setCellW(e.nativeEvent.layout.width - 1)}
      style={{
        flex: 1,
        flexDirection: "row",
        gap: CHIP_GAP,
        paddingVertical: 2,
        borderLeftWidth: 1,
        borderLeftColor: `${t.ink}33`,
        backgroundColor: t.surface,
      }}
    >
      {cellW > 0
        ? appointments.slice(0, shown).map((a, i) => {
            const c = blockColors(a);
            const cancelled = a.status === "cancelled";
            const reserve =
              overflow > 0 && i === shown - 1 ? chipOverflowW(overflow) : 0;
            const pad = chipPad(chipW);
            const textW = chipTextW(chipW, reserve);
            const name = clientName(a) || a.comment || "Событие";
            return (
              <Pressable
                key={a.id}
                onPress={() => onEdit(a)}
                onLongPress={onMenu ? () => onMenu(a) : undefined}
                delayLongPress={350}
                // 36pt полосы плюс 4pt запаса с каждой стороны — мишень 44pt,
                // как требует закон продукта. Наружу больше не растим: снизу
                // сразу первый час сетки, и лишние точки крали бы у него тап
                // «создать запись».
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Весь день, ${name}${
                  reserve > 0 ? `, ещё ${overflow}` : ""
                }`}
                style={({ pressed }) => ({
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "center",
                  paddingHorizontal: pad,
                  borderWidth: 1,
                  borderColor: cancelled ? CANCELLED_EDGE : c.contour,
                  borderStyle: cancelled ? CANCELLED_BORDER : "solid",
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  overflow: "hidden",
                  // Тот же плотный рецепт, что у блока сетки (вариант 7).
                  backgroundColor: cancelled
                    ? fillRgba(t.ink, pressed ? 0.2 : 0.0784)
                    : pressed
                      ? c.pressed
                      : c.solid,
                })}
              >
                {/* УГЛОВЫХ ЗНАКОВ У ЧИПА НЕТ СОЗНАТЕЛЬНО: «просрочено» к
                    событию неприменимо по построению, а галка «выполнено» на
                    25pt высоты рядом с текстом — тот самый шум. Выполненное
                    событие гаснет заливкой, как блок. */}
                {textW >= TEXT_MIN_W ? (
                  <Text
                    numberOfLines={1}
                    ellipsizeMode={textW < 96 ? "clip" : "tail"}
                    maxFontSizeMultiplier={1.3}
                    style={{
                      color: cancelled ? t.ink : BLOCK_TEXT,
                      fontSize: 13,
                      lineHeight: lineH,
                      fontWeight: "700",
                      marginRight: reserve,
                      textDecorationLine: cancelled ? "line-through" : "none",
                    }}
                  >
                    {name}
                  </Text>
                ) : null}
                {reserve > 0 ? (
                  // «+N» — СВОЯ ДВЕРЬ, а не подпись. Тап по чипу открывает
                  // ПЕРВОЕ событие, и без отдельной мишени остальные были бы
                  // недостижимы вовсе. Мишень узкая по ширине, но во всю высоту
                  // полосы и с запасом наружу.
                  <Pressable
                    onPress={onOverflow}
                    disabled={!onOverflow}
                    hitSlop={{ top: 4, bottom: 4, right: 4, left: 2 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Ещё ${overflow} на весь день`}
                    style={{
                      position: "absolute",
                      right: pad,
                      top: 0,
                      bottom: 0,
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        // «+N» лежит на плотной заливке чипа — белым, как имя.
                        color: BLOCK_TEXT,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`+${overflow}`}
                    </Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}
