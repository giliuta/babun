import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  timeToMinutes,
  minutesToTime,
  type ScheduleBreak,
} from "@babun/shared/local/schedule";
import { AddRow } from "@/components/ui/AddRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { HourRangeSheet } from "@/features/calendar/HourRangeSheet";
import { useThemeColors } from "@/theme/colors";

// Перерывы дня (обед и т.п.) — секция редактора ОСОБОГО ДНЯ (страница с датой).
// Родитель отдаёт breaks и забирает следующий список через onChange
// (instant-commit, как весь экран).
//
// НЕДЕЛЬНЫЙ ГРАФИК ЭТУ СЕКЦИЮ БОЛЬШЕ НЕ ЗОВЁТ: с 2026-08-17 он лист, и перерыв
// там — чип со своими часами над общим барабаном (`TeamScheduleSheet`).
//
// ВРЕМЯ — БАРАБАНОМ (владелец 2026-09-10: «барабан везде»). Здесь стояли ДВА
// компактных нативных пикера прямо в строке, и оправдание было такое: «на
// странице особого дня они не конкурируют с барабаном — барабана там нет».
// Оправдание держалось на отсутствии барабана, а не на пользе: два прицельных
// касания по 30pt одной рукой в машине против одного тапа по строке. Теперь
// строка открывает тот же `HourRangeSheet`, что и рабочие часы дня, — пара
// границ с сегментом «Начало|Конец». Перерыв по-прежнему не сущность со
// страницей, а два времени.

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

  /** Какой перерыв правим листом. null — лист закрыт. */
  const [editing, setEditing] = useState<number | null>(null);
  // Пока лист уезжает, строки уже может не быть (её убрали) — держим
  // безопасный запас, иначе лист мигает пустыми часами на анимации.
  const current = (editing !== null ? breaks[editing] : undefined) ?? {
    start: dayStart,
    end: dayEnd,
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
              {/* Пара границ — одним тапом по строке. Значение и есть подпись:
                  «Перерыв» слева, часы справа, как в любой строке-двери. */}
              <Pressable
                onPress={() => setEditing(i)}
                accessibilityRole="button"
                accessibilityLabel={`Перерыв ${b.start} – ${b.end}, изменить`}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 44,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ flex: 1, fontSize: 16, color: t.ink }}>
                  Перерыв
                </Text>
                <Text style={{ fontSize: 16, color: t.body }}>
                  {`${b.start} – ${b.end}`}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => commit(breaks.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel="Убрать перерыв"
                hitSlop={10}
                style={({ pressed }) => ({
                  marginLeft: 14,
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

      {/* Тот же лист, что у рабочих часов дня: сегмент «Начало|Конец», под ним
          барабан. Конец позже начала лист чинит сам. */}
      <HourRangeSheet
        visible={editing !== null}
        title="Перерыв"
        value={{
          start: hourOf(current.start),
          startMinute: minuteOf(current.start),
          end: hourOf(current.end),
          endMinute: minuteOf(current.end),
        }}
        allowEndOfDay={false}
        onApply={({ start, end, startMinute, endMinute }) => {
          if (editing === null) return;
          setAt(editing, {
            start: hm(start, startMinute),
            end: hm(end, endMinute),
          });
        }}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

/** «HH:MM» → части и обратно. Живут здесь: наружу нужны только строки. */
function hourOf(value: string): number {
  return Number(value.slice(0, 2)) || 0;
}
function minuteOf(value: string): number {
  return Number(value.slice(3, 5)) || 0;
}
function hm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
