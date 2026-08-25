import { Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  timeToMinutes,
  minutesToTime,
  type ScheduleBreak,
} from "@babun/shared/local/schedule";
import { AddRow } from "@/components/ui/AddRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors } from "@/theme/colors";
import { formatHM, parseHM } from "@/features/appointments/helpers";

// Перерывы дня (обед и т.п.) — секция редактора ОСОБОГО ДНЯ (страница с датой).
// Родитель отдаёт breaks и забирает следующий список через onChange
// (instant-commit, как весь экран).
//
// НЕДЕЛЬНЫЙ ГРАФИК ЭТУ СЕКЦИЮ БОЛЬШЕ НЕ ЗОВЁТ: с 2026-08-17 он лист, и перерыв
// там — чип со своими часами над общим барабаном (`TeamScheduleSheet`), потому
// что двух разных контролов времени в одном листе быть не должно (DS §5). Здесь
// остались компактные нативные пикеры прямо в строке: на СТРАНИЦЕ особого дня
// они не конкурируют с барабаном — барабана там нет.
//
// Строка перерыва — пара компактных нативных пикеров прямо в строке (рецепт
// TimeField) и тихое «Убрать»: перерыв — не сущность со страницей, а два
// времени.

/** Новый перерыв — час около 13:00, прижатый внутрь смены. */
function defaultBreak(dayStart: string, dayEnd: string): ScheduleBreak {
  const s = timeToMinutes(dayStart);
  const e = timeToMinutes(dayEnd);
  const start = Math.max(s, Math.min(13 * 60, e - 60));
  return { start: minutesToTime(start), end: minutesToTime(start + 60) };
}

export function BreaksSection({
  dayStart,
  dayEnd,
  breaks,
  onChange,
}: {
  /** Границы смены — только чтобы новый перерыв рождался внутри неё. */
  dayStart: string;
  dayEnd: string;
  breaks: ScheduleBreak[];
  onChange: (next: ScheduleBreak[]) => void;
}) {
  const t = useThemeColors();

  const commit = (next: ScheduleBreak[]) =>
    // Держим список по возрастанию: сетка порядку безразлична, а человек
    // читает перерывы сверху вниз как день.
    onChange([...next].sort((a, b) => a.start.localeCompare(b.start)));

  // Конец обязан быть позже начала — та же минимальная починка пары, что у
  // границ смены: двигаем ту сторону, которую сейчас не трогают.
  const setAt = (i: number, patch: Partial<ScheduleBreak>) => {
    const cur = breaks[i];
    const next = { ...cur, ...patch };
    if (next.end <= next.start) {
      const startMin = timeToMinutes(next.start);
      if (patch.start !== undefined) {
        next.end = minutesToTime(Math.min(24 * 60 - 5, startMin + 60));
      } else {
        next.start = minutesToTime(Math.max(0, timeToMinutes(next.end) - 60));
      }
    }
    commit(breaks.map((b, j) => (j === i ? next : b)));
  };

  return (
    <>
      <SectionEyebrow>Перерывы</SectionEyebrow>
      <SectionCard>
        {breaks.map((b, i) => (
          <View key={i}>
            {i > 0 ? <Divider inset={16} /> : null}
            <View
              style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 6,
              }}
            >
              <Text style={{ flex: 1, fontSize: 16, color: t.ink }}>
                Перерыв
              </Text>
              <DateTimePicker
                themeVariant="light"
                value={parseHM(b.start)}
                mode="time"
                display="compact"
                minuteInterval={5}
                accessibilityLabel="Начало перерыва"
                onChange={(_, d) => d && setAt(i, { start: formatHM(d) })}
              />
              <Text style={{ fontSize: 16, color: t.faint, marginHorizontal: 2 }}>
                –
              </Text>
              <DateTimePicker
                themeVariant="light"
                value={parseHM(b.end)}
                mode="time"
                display="compact"
                minuteInterval={5}
                accessibilityLabel="Конец перерыва"
                onChange={(_, d) => d && setAt(i, { end: formatHM(d) })}
              />
              <Pressable
                onPress={() => commit(breaks.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel="Убрать перерыв"
                hitSlop={10}
                style={({ pressed }) => ({
                  marginLeft: 10,
                  minHeight: 44,
                  justifyContent: "center",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text
                  style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
                >
                  Убрать
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
        <AddRow
          label="Добавить перерыв"
          separated={breaks.length > 0}
          onPress={() => commit([...breaks, defaultBreak(dayStart, dayEnd)])}
        />
      </SectionCard>
    </>
  );
}
