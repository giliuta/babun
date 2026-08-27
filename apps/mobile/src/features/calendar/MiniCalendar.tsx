import { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { weekdayIndex, weekdayLabels } from "@/features/calendar/week";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { useThemeColors } from "@/theme/colors";

// ЛИСТАЕТСЯ СВАЙПОМ, А НЕ ТОЛЬКО СТРЕЛКАМИ (владелец 2026-08-27: «стрелочки
// влево-вправо это классно, но я хотел бы ещё листать свайпом»).
//
// Свайп НЕ написан здесь заново: взят `usePeriodPager` — тот же механизм,
// которым листаются день и неделя в самом календаре. Он даёт «бесконечную
// ось»: смонтированы ровно три месяца (пред / текущий / след), контент едет
// ЗА ПАЛЬЦЕМ, отпускание доводит до соседнего. Второй свайп в продукте
// заводить нельзя — жест обязан ощущаться одинаково везде, где листают
// период (канон §5, «Горизонтальный пейджинг периода»).
//
// Стрелки остались и работают как ВНЕШНИЙ прыжок: пейджер это умеет —
// ось встаёт на новый месяц без доводки. Убирать их нельзя: свайп невидим,
// а VoiceOver его не знает вовсе.
//
// Высота сетки ФИКСИРОВАНА шестью рядами. В месяце бывает 5 или 6 недель, и
// без фиксации попап дёргался бы по высоте на каждом свайпе — а он висит
// под шапкой, то есть прыгал бы прямо под пальцем.
//
// Web-parity date jumper (web MiniCalendar, trimmed): tap the «Месяц Год ⌄»
// header title → this popover; pick any day to jump the calendar there.
// Dot under a day = it has non-cancelled appointments. «Сегодня» at the
// bottom returns home. (Long-press preview + year grid stay web-only.)
export function MiniCalendar({
  visible,
  currentDate,
  todayYmd,
  appointments,
  onSelectDate,
  onClose,
}: {
  visible: boolean;
  currentDate: Date;
  /** Business-timezone today (YYYY-MM-DD). */
  todayYmd: string;
  appointments: Appointment[];
  onSelectDate: (d: Date) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [viewYear, setViewYear] = useState(currentDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(currentDate.getMonth());

  // Re-anchor to the calendar's date every time the popover opens.
  const [anchorKey, setAnchorKey] = useState("");
  const openKey = visible ? formatYMD(currentDate) : "";
  if (visible && anchorKey !== openKey) {
    setAnchorKey(openKey);
    setViewYear(currentDate.getFullYear());
    setViewMonth(currentDate.getMonth());
  }
  // Зеркальная ветка: без сброса якоря повторное открытие на ТОЙ ЖЕ дате
  // показывало бы пролистанный в прошлый раз месяц.
  if (!visible && anchorKey !== "") setAnchorKey("");

  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      m.set(a.date, (m.get(a.date) ?? 0) + 1);
    }
    return m;
  }, [appointments]);

  const DAY_HEADERS = weekdayLabels();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else setViewMonth(viewMonth + 1);
  };

  // Пейджер месяцев. periodKey меняется и от свайпа, и от стрелок — во
  // втором случае это внешний прыжок, ось встаёт без доводки.
  const pager = usePeriodPager({
    periodKey: `${viewYear}-${viewMonth}`,
    onCommit: (dir) => (dir === 1 ? nextMonth() : prevMonth()),
  });

  const monthTitle = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(/\s*г\.?\s*$/i, "");

  // 44 — минимальная тап-мишень HIG: раньше 40pt-ячейки были единственным
  // суб-минимальным контролом всего джампера.
  const CELL = 44;
  // Шесть рядов всегда: в месяце бывает 5 или 6 недель, и без фиксации
  // попап дёргался бы по высоте на каждом свайпе.
  const GRID_H = 6 * CELL;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* accessible={false} на скриме и карточке: иначе VoiceOver схлопывает
          весь поповер в один безымянный «button» и дни недостижимы. */}
      <Pressable
        accessible={false}
        style={{ flex: 1, backgroundColor: t.scrim }}
        onPress={onClose}
      >
        <Pressable
          // Stop taps inside the card from closing the modal.
          onPress={() => {}}
          accessible={false}
          // Жест-escape VoiceOver: иначе из джампера не выйти, не сменив дату.
          onAccessibilityEscape={onClose}
          style={{
            position: "absolute",
            top: insets.top + 52,
            left: 12,
            // +24 паддинги, +2 рамка (RN border-box): без учёта рамки на
            // контент оставалось 7×CELL−2 и седьмая ячейка переносилась —
            // сетка ехала по 6 дней в ряду.
            width: 7 * CELL + 24 + 2,
            backgroundColor: t.surface,
            borderRadius: t.radius.card,
            borderWidth: 1,
            borderColor: t.separator,
            padding: 12,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <Pressable
              onPress={prevMonth}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: t.radius.card,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <ChevronLeft color={t.sub} size={16} strokeWidth={2.5} />
            </Pressable>
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink, textTransform: "capitalize" }}
            >
              {monthTitle}
            </Text>
            <Pressable
              onPress={nextMonth}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: t.radius.card,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <ChevronRight color={t.sub} size={16} strokeWidth={2.5} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row" }}>
            {DAY_HEADERS.map((d) => (
              <Text
                key={d}
                maxFontSizeMultiplier={1.2}
                // 11/700/+0.6 — канон iOS-капса для подписей дней недели.
                style={{
                  width: CELL,
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: t.sub,
                  paddingVertical: 4,
                }}
              >
                {d}
              </Text>
            ))}
          </View>

          {/* Три месяца на бесконечной оси; жест — тот же `usePeriodPager`,
              что листает день и неделю. */}
          <GestureDetector gesture={pager.pan}>
            <View style={{ height: GRID_H }}>
              <PagedStrip
                pager={pager}
                renderPage={(off) => {
                  const anchor = new Date(viewYear, viewMonth + off, 1);
                  const y = anchor.getFullYear();
                  const m = anchor.getMonth();
                  const lead = weekdayIndex(anchor.getDay());
                  const total = new Date(y, m + 1, 0).getDate();
                  return (
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {Array.from({ length: lead }).map((_, i) => (
                        <View key={`e-${i}`} style={{ width: CELL, height: CELL }} />
                      ))}
                      {Array.from({ length: total }).map((_, i) => {
                        const day = i + 1;
                        const date = new Date(y, m, day);
                        const key = formatYMD(date);
                        const isToday = key === todayYmd;
                        // Просматриваемый сейчас день (≠ сегодня) — лёгкий
                        // акцентный тинт: джампер открывают, уйдя с сегодня,
                        // и точка отсчёта обязана быть видна (HIG).
                        const isViewed = !isToday && key === openKey;
                        const count = countByDate.get(key) ?? 0;
                        return (
                          <Pressable
                            key={day}
                            onPress={() => onSelectDate(date)}
                            accessibilityRole="button"
                            accessibilityLabel={`${day} ${date.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${isViewed ? ", открыт" : ""}${count > 0 ? `, записей: ${count}` : ""}`}
                            style={({ pressed }) => ({
                              width: CELL,
                              height: CELL,
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: CELL / 2,
                              backgroundColor: isToday
                                ? t.accent
                                : isViewed
                                  ? `${t.accent}14`
                                  : pressed
                                    ? t.pressed
                                    : "transparent",
                            })}
                          >
                            <Text
                              maxFontSizeMultiplier={1.2}
                              // fontVariant, а НЕ className="tabular-nums":
                              // класс — чистый no-op, NativeWind молча его
                              // выбрасывает (канон §2), и числа прыгали.
                              style={{
                                fontSize: 14,
                                fontWeight: isToday || isViewed ? "700" : "400",
                                fontVariant: ["tabular-nums"],
                                color: isToday
                                  ? t.onAccent
                                  : isViewed
                                    ? t.accent
                                    : t.ink,
                              }}
                            >
                              {day}
                            </Text>
                            <View
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: 2,
                                marginTop: 1,
                                backgroundColor:
                                  count > 0
                                    ? isToday
                                      ? "rgba(255,255,255,0.8)"
                                      : t.accent
                                    : "transparent",
                              }}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                }}
              />
            </View>
          </GestureDetector>

          <Pressable
            onPress={() => {
              const [y, m, d] = todayYmd.split("-").map(Number);
              onSelectDate(new Date(y, (m || 1) - 1, d || 1));
            }}
            accessibilityRole="button"
            accessibilityLabel="Перейти к сегодняшней дате"
            // 44 — минимальная высота нажимаемой области HIG; радиус 14 = input.
            style={({ pressed }) => ({
              marginTop: 8,
              height: 44,
              borderRadius: t.radius.card,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${t.accent}1a`,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 13, fontWeight: "600", color: t.accent }}
            >
              Сегодня
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
