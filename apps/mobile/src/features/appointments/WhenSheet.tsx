import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { TimeRangePicker } from "@/components/ui/TimeWheel";
import { shiftRangeStart } from "@/features/appointments/time-range";
import { useThemeColors } from "@/theme/colors";
import { useBusinessToday } from "@/features/settings/business-today";
import { WHEN_WEEKS_BACK, WHEN_WEEKS_FWD, formatDateRu } from "./when-dates";
import { FOOTER_SIDE } from "@/components/ui/tokens";

// «КОГДА» — ШТОРКА СНИЗУ, А НЕ ОКНО ПО ЦЕНТРУ: тап по времени открывает её
// снизу вверх — два барабана, один тумблер, то же самое, что период в
// финансах и график команды: сегмент «Начало | Конец» переключает, какую
// границу крутишь, барабанов на экране одна пара, а действие живёт в футере
// листа — «Применить». (Центрированное окно с ДВУМЯ парами барабанов и
// кнопками «Отмена/Готово» в подвале карточки было бы другим диалектом.)
//
// Сверху полоса недель: дата тапается там же, где выбирается время, и
// свайпается по неделям.
//
// Правки живут в локальном черновике и применяются только по «Применить»;
// закрытие скримом или свайпом — отказ, как у любого листа.

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]; // понедельник-first
const ALL_DAY_RANGE = { start: "00:00", end: "23:59" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function parseTime(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
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
// «31 августа – 6 сентября»: число с месяцем стоит в родительном падеже,
// как в подписи даты выше. Именительный («31 АВГУСТ») читался как опечатка
// (находка Б1 аудита STORY-064).

interface Draft {
  date: string;
  timeStart: string;
  timeEnd: string;
  allDay: boolean;
}

export function WhenSheet({
  open,
  onClose,
  date,
  timeStart,
  timeEnd,
  allDay,
  allowAllDay = true,
  singleTime = false,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  timeStart: string;
  timeEnd: string;
  allDay: boolean;
  allowAllDay?: boolean;
  /** У ОПЕРАЦИИ ВРЕМЯ ОДНО. Деньги случились в момент, а не длились отрезок:
   *  сегмент «Начало | Конец» и барабаны конца для неё — контрол, который
   *  ничем не управляет. Полоса недель, барабаны и язык листа при этом те же,
   *  что у записи (блоки операции — как в записи). */
  singleTime?: boolean;
  onCommit: (next: Draft) => void;
}) {
  const t = useThemeColors();

  const [draft, setDraft] = useState<Draft>({
    date,
    timeStart,
    timeEnd,
    allDay: allowAllDay && allDay,
  });
  const [anchorKey, setAnchorKey] = useState(date);

  const [pageWidth, setPageWidth] = useState(0);
  const preAllDayRef = useRef<{ start: string; end: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!open) return;
    const effectiveAllDay = allowAllDay && allDay;
    setDraft({ date, timeStart, timeEnd, allDay: effectiveAllDay });
    setAnchorKey(date);
    preAllDayRef.current = effectiveAllDay ? null : { start: timeStart, end: timeEnd };
  }, [open, date, timeStart, timeEnd, allDay, allowAllDay]);

  // «СЕГОДНЯ» — ПО ПОЯСУ КОМПАНИИ, как вся форма записи. Часы телефона в
  // другом поясе около полуночи подсвечивали соседний день.
  const businessToday = useBusinessToday();
  const today = useMemo(() => {
    const [y, m, d] = businessToday.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [businessToday]);

  const weeks = useMemo(() => {
    const anchorMon = mondayOf(anchorKey);
    return Array.from({ length: WHEN_WEEKS_BACK + WHEN_WEEKS_FWD + 1 }, (_, i) => {
      const monday = addDays(anchorMon, (i - WHEN_WEEKS_BACK) * 7);
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

  const [sh, sm] = parseTime(draft.timeStart);
  const [eh, em] = parseTime(draft.timeEnd);

  // НАЧАЛО ТЯНЕТ КОНЕЦ ЗА СОБОЙ — то же правило, что и было: сдвиг начала
  // переносит запись целиком, длительность меняет только барабан конца.
  const patchStart = (patch: { hour?: number; minute?: number }) => {
    setDraft((d) => {
      const [h, m] = parseTime(d.timeStart);
      const next = `${pad2(patch.hour ?? h)}:${pad2(patch.minute ?? m)}`;
      return { ...d, ...shiftRangeStart(d.timeStart, d.timeEnd, next) };
    });
  };
  const patchEnd = (patch: { hour?: number; minute?: number }) => {
    setDraft((d) => {
      const [h, m] = parseTime(d.timeEnd);
      const hour = patch.hour ?? h;
      const minute = patch.minute ?? m;
      const [dsh, dsm] = parseTime(d.timeStart);
      // Конец раньше начала — не отрезок, а опечатка: молча не принимаем.
      if (hour * 60 + minute <= dsh * 60 + dsm) return d;
      return { ...d, timeEnd: `${pad2(hour)}:${pad2(minute)}` };
    });
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

  // ПОДПИСИ «14–20 СЕНТЯБРЯ» ПОД ПОЛОСОЙ БОЛЬШЕ НЕТ: месяц называет заголовок
  // листа, а числа стоят в самих клетках — строка повторяла и то и другое, и
  // стоила высоты.

  return (
    <BottomSheet
      visible={open}
      onClose={onClose}
      title={`Когда · ${formatDateRu(draft.date)}`}
      padded={false}
      maxHeightRatio={0.72}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button
            label="Применить"
            onPress={() => {
              onCommit({ ...draft, allDay: allowAllDay && draft.allDay });
              onClose();
            }}
          />
        </View>
      }
    >
      {/* ПЛОТНО, В ОДИН ЭКРАН: время должно помещаться в одну страничку. Полоса
          дат, сегмент и барабаны — три предмета; воздух между ними считаем
          скупо, иначе лист лезет под кнопку. */}
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {/* ПОЛОСА НЕДЕЛЬ. Свайпается по неделям, тап выбирает день —
            дата и время правятся в одном месте. */}
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
                initialScrollIndex={WHEN_WEEKS_BACK}
                getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
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
                              height: 46,
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
                              maxFontSizeMultiplier={1.2}
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
                              maxFontSizeMultiplier={1.2}
                              style={{
                                fontSize: 17,
                                fontWeight: "700",
                                lineHeight: 18,
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
              <View style={{ height: 46 }} />
            )}
          </View>
        </View>

        {/* ОДИН ТУМБЛЕР — «ВЕСЬ ДЕНЬ», и только у события: у работы весь день
            не бывает, её длительность считают услуги. */}
        {allowAllDay ? (
          <SwitchRow
            label="Весь день"
            value={draft.allDay}
            onChange={setAllDay}
            inset={false}
          />
        ) : null}

        {/* ОДНА ПАРА БАРАБАНОВ И СЕГМЕНТ «НАЧАЛО | КОНЕЦ» — тот же контрол,
            что у периода в финансах и у графика команды. Двух пар рядом
            больше нет: на полэкрана они не помещаются, и человек всё равно
            крутит по одной. */}
        {!draft.allDay ? (
          <TimeRangePicker
            start={{ hour: sh, minute: sm }}
            end={{ hour: eh, minute: em }}
            singleSide={singleTime}
            onChangeStart={patchStart}
            onChangeEnd={patchEnd}
            // Запись кончается часом суток, а не их концом: 24:00 у неё не
            // бывает (`addMinutesHM` клампит к 23:59).
            allowEndOfDay={false}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
