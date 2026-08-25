import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/colors";
import {
  MINUTE_STEP,
  TimeWheelPair,
} from "@/components/ui/TimeWheel";

// Портирован 1:1 из веба (apps/web UnifiedTimePopup + TimeWheels +
// WheelColumn): один центрированный попап для выбора даты + начала/конца.
// Полоса недель свайпается (снап по неделе), два колеса «Начало»/«Конец»,
// переключатель «Весь день». Правки живут в локальном черновике и
// применяются только по «Готово»; «Отмена» отбрасывает.
// Барабаны — канонический `TimeWheelPair` из @/components/ui/TimeWheel
// (закольцованные часы и пятиминутки, DS §5; общий с BookSlotSheet и часами
// календаря).
//
// ШАГ МИНУТ ВСЕГДА ПЯТЬ, и настройкой он больше не бывает. Здесь жил проп
// `stepMinutes` с набором 5/10/15/20/30/60, но единственный вызывающий
// (app/book) передавал ровно 5 и объяснял почему: когда сюда приезжала
// «Длительность записи» тенанта, «30 минут» превращали колонку минут в
// «00 / 30» — запись на 10:15 создать было нельзя, а время 09:35 из листа
// слота показывалось как 09:30 и молча дописывалось при первом касании.
// Длительность задаёт КОНЕЦ записи, а не сетку выбора времени.

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]; // понедельник-first
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_NOM = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const WEEKS_BACK = 26;
const WEEKS_FWD = 26;
const ALL_DAY_RANGE = { start: "00:00", end: "23:59" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function parseTime(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}
function minutesToHHMM(mins: number): string {
  const c = Math.max(0, Math.min(24 * 60 - 1, mins));
  return `${pad2(Math.floor(c / 60))}:${pad2(c % 60)}`;
}
function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(base.getDate() + n);
  return d;
}
function mondayOf(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}
function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatDateRu(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}
function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${MONTHS_NOM[sunday.getMonth()]}`;
  }
  return `${monday.getDate()} ${MONTHS_NOM[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS_NOM[sunday.getMonth()]}`;
}

interface Draft {
  date: string;
  timeStart: string;
  timeEnd: string;
  allDay: boolean;
}

export function UnifiedTimePopup({
  open,
  onClose,
  date,
  timeStart,
  timeEnd,
  allDay,
  allowAllDay = true,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  timeStart: string;
  timeEnd: string;
  allDay: boolean;
  allowAllDay?: boolean;
  onCommit: (next: Draft) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<Draft>({
    date,
    timeStart,
    timeEnd,
    allDay: allowAllDay && allDay,
  });
  const [anchorKey, setAnchorKey] = useState(date);
  const [pageIndex, setPageIndex] = useState(WEEKS_BACK);
  const [pageWidth, setPageWidth] = useState(0);
  const preAllDayRef = useRef<{ start: string; end: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!open) return;
    const effectiveAllDay = allowAllDay && allDay;
    setDraft({ date, timeStart, timeEnd, allDay: effectiveAllDay });
    setAnchorKey(date);
    setPageIndex(WEEKS_BACK);
    preAllDayRef.current = effectiveAllDay ? null : { start: timeStart, end: timeEnd };
  }, [open, date, timeStart, timeEnd, allDay, allowAllDay]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weeks = useMemo(() => {
    const anchorMon = mondayOf(anchorKey);
    return Array.from({ length: WEEKS_BACK + WEEKS_FWD + 1 }, (_, i) => {
      const monday = addDays(anchorMon, (i - WEEKS_BACK) * 7);
      const days = Array.from({ length: 7 }, (_, j) => {
        const d = addDays(monday, j);
        return {
          key: dateToKey(d),
          weekday: WEEKDAYS[j],
          day: d.getDate(),
          isToday: sameYMD(d, today),
        };
      });
      return { monday, days };
    });
  }, [anchorKey, today]);

  if (!open) return null;

  const [sh, sm] = parseTime(draft.timeStart);
  const [eh, em] = parseTime(draft.timeEnd);
  const startHourIdx = Math.max(0, Math.min(23, sh));
  const startMinIdx = Math.floor(sm / MINUTE_STEP);
  const endHourIdx = Math.max(0, Math.min(23, eh));
  const endMinIdx = Math.floor(em / MINUTE_STEP);
  const startTotal = sh * 60 + sm;

  const commitStart = (hour: number, min: number) => {
    const nextStartTotal = hour * 60 + min;
    setDraft((d) => {
      const [deh, dem] = parseTime(d.timeEnd);
      const endTotal = deh * 60 + dem;
      const nextStart = `${pad2(hour)}:${pad2(min)}`;
      const nextEnd =
        endTotal <= nextStartTotal ? minutesToHHMM(nextStartTotal + 60) : d.timeEnd;
      return { ...d, timeStart: nextStart, timeEnd: nextEnd };
    });
  };
  const commitEnd = (hour: number, min: number) => {
    if (hour * 60 + min <= startTotal) return;
    setDraft((d) => ({ ...d, timeEnd: `${pad2(hour)}:${pad2(min)}` }));
  };

  const setAllDay = (v: boolean) => {
    setDraft((d) => {
      if (v) {
        if (!d.allDay) preAllDayRef.current = { start: d.timeStart, end: d.timeEnd };
        return { ...d, allDay: true, timeStart: ALL_DAY_RANGE.start, timeEnd: ALL_DAY_RANGE.end };
      }
      const prev = preAllDayRef.current;
      return { ...d, allDay: false, timeStart: prev?.start ?? "10:00", timeEnd: prev?.end ?? "11:00" };
    });
  };

  const rangeLabel = formatWeekRange(
    weeks[Math.max(0, Math.min(weeks.length - 1, pageIndex))].monday,
  );
  const summary = `${formatDateRu(draft.date)}, ${
    draft.allDay ? "весь день" : `с ${draft.timeStart} до ${draft.timeEnd}`
  }`;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessible={false}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.scrim,
          paddingHorizontal: 12,
          paddingBottom: insets.bottom,
        }}
      >
        <Pressable
          onPress={() => {}}
          accessible={false}
          style={{
            width: "100%",
            maxWidth: 440,
            backgroundColor: t.surface,
            borderRadius: t.radius.card,
            overflow: "hidden",
            boxShadow: t.cardShadow,
          }}
        >
          {/* header: summary + весь день */}
          <View
            className="flex-row items-center gap-3 px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
          >
            <Text
              className="flex-1"
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {summary}
            </Text>
            {allowAllDay ? (
              <View className="flex-row items-center gap-2">
                <Text style={{ fontSize: 11, fontWeight: "700", color: t.sub, letterSpacing: 0.4 }}>
                  ВЕСЬ ДЕНЬ
                </Text>
                <Switch
                  value={draft.allDay}
                  onValueChange={setAllDay}
                  trackColor={{ true: t.accent }}
                  accessibilityLabel="Весь день"
                />
              </View>
            ) : null}
          </View>

          <View className="p-4" style={{ gap: 16 }}>
            {/* week pager */}
            <View>
              <View onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
                {pageWidth > 0 ? (
                  <FlatList
                    ref={listRef}
                    data={weeks}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(w) => w.monday.toISOString()}
                    initialScrollIndex={WEEKS_BACK}
                    getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
                    onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
                      setPageIndex(Math.round(e.nativeEvent.contentOffset.x / pageWidth))
                    }
                    renderItem={({ item: w }: { item: (typeof weeks)[number] }) => (
                      <View style={{ width: pageWidth, flexDirection: "row" }}>
                        {w.days.map((d) => {
                          const active = d.key === draft.date;
                          return (
                            <View key={d.key} style={{ width: pageWidth / 7, paddingHorizontal: 3 }}>
                              <Pressable
                                onPress={() => setDraft((s) => ({ ...s, date: d.key }))}
                                accessibilityRole="radio"
                                accessibilityLabel={`${d.weekday}, ${formatDateRu(d.key)}${d.isToday ? ", сегодня" : ""}`}
                                accessibilityState={{ selected: active }}
                                style={({ pressed }) => ({
                                  height: 58,
                                  borderRadius: t.radius.card,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 2,
                                  transform: [{ scale: pressed ? 0.96 : 1 }],
                                  backgroundColor: active ? t.accent : t.fill,
                                  borderWidth: 1,
                                  borderColor: active
                                    ? "transparent"
                                    : d.isToday
                                      ? t.accent
                                      : "transparent",
                                })}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: "700",
                                    letterSpacing: 0.4,
                                    lineHeight: 11,
                                    color: active
                                      ? "rgba(255,255,255,0.82)"
                                      : d.isToday
                                        ? t.accent
                                        : t.sub,
                                  }}
                                >
                                  {d.weekday}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 19,
                                    fontWeight: "700",
                                    lineHeight: 20,
                                    fontVariant: ["tabular-nums"],
                                    color: active ? "#fff" : d.isToday ? t.accent : t.ink,
                                  }}
                                >
                                  {d.day}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  />
                ) : (
                  <View style={{ height: 58 }} />
                )}
              </View>
              <Text
                className="mt-2 text-center"
                style={{ fontSize: 11, fontWeight: "700", color: t.sub, letterSpacing: 0.5 }}
              >
                {rangeLabel.toUpperCase()}
              </Text>
            </View>

            {/* two wheels — hidden when all-day */}
            {!draft.allDay ? (
              <View className="flex-row items-start justify-center pt-1" style={{ gap: 40 }}>
                <WheelSide
                  label="НАЧАЛО"
                  hour={startHourIdx}
                  minute={startMinIdx * MINUTE_STEP}
                  onHour={(h) => commitStart(h, startMinIdx * MINUTE_STEP)}
                  onMin={(m) => commitStart(startHourIdx, m)}
                />
                <WheelSide
                  label="КОНЕЦ"
                  hour={endHourIdx}
                  minute={endMinIdx * MINUTE_STEP}
                  onHour={(h) => commitEnd(h, endMinIdx * MINUTE_STEP)}
                  onMin={(m) => commitEnd(endHourIdx, m)}
                />
              </View>
            ) : null}
          </View>

          {/* footer */}
          <View
            className="flex-row gap-2 px-4 py-3"
            style={{ borderTopWidth: 1, borderTopColor: t.separator }}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Отмена"
              style={{
                flex: 1,
                height: 44,
                borderRadius: t.radius.card,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.fill,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>Отмена</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onCommit({ ...draft, allDay: allowAllDay && draft.allDay });
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Применить дату и время"
              style={{
                flex: 1,
                height: 44,
                borderRadius: t.radius.card,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.accent,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.onAccent }}>Готово</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function WheelSide({
  label,
  hour,
  minute,
  onHour,
  onMin,
}: {
  label: string;
  hour: number;
  minute: number;
  onHour: (hour: number) => void;
  onMin: (minute: number) => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: t.sub, letterSpacing: 0.4 }}>
        {label}
      </Text>
      <TimeWheelPair
        hour={hour}
        minute={minute}
        onChangeHour={onHour}
        onChangeMinute={onMin}
        labelPrefix={label.toLowerCase()}
      />
    </View>
  );
}

