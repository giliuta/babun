import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { findOverlap } from "@babun/shared/common/utils/appointment-overlap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  addMinutesHM,
  formatHM,
  formatYMD,
  humanDay,
  parseHM,
  parseYMD,
} from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";

// Пре-попап тапа по свободному слоту (web SlotConfirmPopup, улучшенный):
// дата и время правятся сразу «тумблерами» — стрелки ±день + нативное
// колесо времени (шаг 5 мин, точность записи), конец тянется за стартом
// на длительность слота. Две ставки внизу: «Записать клиента» — акцент в
// зоне большого пальца, «Событие» — контур над ним (web parity: stacked
// footer). Полная форма открывается ПОСЛЕ выбора — с уже верным
// временем и типом (тип в форме остаётся переключаемым сегментом).
// Улучшения против веба: смена даты прямо в попапе (у веба даты нет),
// живое «до HH:MM» и предупреждение о пересечении до открытия формы.
export function SlotConfirmPopup({
  slot,
  appointments,
  durationMin,
  onClose,
  onConfirm,
}: {
  /** Тапнутый слот (null = закрыт). */
  slot: { date: string; time_start: string } | null;
  /** Видимый набор записей — проверка пересечения по черновой дате. */
  appointments: Appointment[];
  /** Длительность черновика (шаг сетки) — для «до HH:MM» и пересечений. */
  durationMin: number;
  onClose: () => void;
  onConfirm: (
    kind: "work" | "event",
    next: { date: string; time_start: string },
  ) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();

  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("");
  useEffect(() => {
    if (!slot) return;
    setDate(slot.date);
    setTimeStart(slot.time_start);
  }, [slot]);

  const timeEnd = timeStart ? addMinutesHM(timeStart, durationMin) : "";

  const shiftDay = (dir: 1 | -1) => {
    if (!date) return;
    const d = parseYMD(date);
    d.setDate(d.getDate() + dir);
    setDate(formatYMD(d));
    haptics.tap();
  };

  // Пересечение считаем черновой записью на выбранную дату — тот же
  // «предупредить, не блокировать», что в шите и при drag-переносе.
  const overlap = useMemo(() => {
    if (!slot || !date || !timeStart) return null;
    return findOverlap(
      {
        id: "slot-draft",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        kind: "work",
        status: "scheduled",
      } as unknown as Appointment,
      appointments,
    );
  }, [slot, date, timeStart, timeEnd, appointments]);

  const confirm = (kind: "work" | "event") => {
    if (!date || !timeStart) return;
    haptics.tap();
    onConfirm(kind, { date, time_start: timeStart });
  };

  return (
    <Modal
      visible={slot != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable
          className="flex-1"
          onPress={onClose}
          accessible={false}
        />
        <View
          className="overflow-hidden rounded-t-3xl"
          style={{
            backgroundColor: t.canvas,
            paddingBottom: insets.bottom + 8,
          }}
        >
          {/* header: живой заголовок «дата · время» + ✕ (web parity) */}
          <View
            className="flex-row items-center justify-between border-b px-4 py-3"
            style={{ borderColor: t.separator }}
          >
            <Text
              className="flex-1 text-[17px] font-semibold tabular-nums"
              numberOfLines={1}
              style={{ color: t.ink }}
            >
              {date ? humanDay(date) : ""} · {timeStart}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
            >
              <X color={t.faint} size={ICON.md} />
            </Pressable>
          </View>

          {/* дата — тумблер ±день: попап должен оставаться быстрым, полный
              календарь есть в форме; стрелками удобно «на завтра/послезавтра» */}
          <View className="mx-4 mt-1 flex-row items-center justify-between py-1">
            <Pressable
              onPress={() => shiftDay(-1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Днём раньше"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <ChevronLeft color={t.accent} size={ICON.md} strokeWidth={2.5} />
            </Pressable>
            <Text
              className="text-[15px] font-semibold"
              style={{ color: t.ink }}
            >
              {date ? humanDay(date) : ""}
            </Text>
            <Pressable
              onPress={() => shiftDay(1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Днём позже"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <ChevronRight color={t.accent} size={ICON.md} strokeWidth={2.5} />
            </Pressable>
          </View>

          {/* время — нативное колесо, шаг 5 мин (точность записи, web STEP=5) */}
          <View className="items-center">
            <DateTimePicker
              value={timeStart ? parseHM(timeStart) : new Date()}
              mode="time"
              display="spinner"
              minuteInterval={5}
              style={{ height: 168 }}
              onChange={(_, d) => d && setTimeStart(formatHM(d))}
            />
          </View>
          <Text
            className="pb-2 text-center text-[13px] tabular-nums"
            style={{ color: t.sub }}
          >
            до {timeEnd} · {durationMin} мин — уточните в форме
          </Text>

          {/* пересечение — предупреждаем, не блокируем (web parity) */}
          {overlap ? (
            <View
              className="mx-4 mb-2 flex-row items-start gap-2 rounded-[14px] border px-3 py-2.5"
              style={{
                backgroundColor: `${t.warning}14`,
                borderColor: `${t.warning}33`,
              }}
            >
              <AlertTriangle color={t.warning} size={ICON.sm} />
              <Text
                className="flex-1 text-[13px] font-medium"
                style={{ color: t.warning }}
              >
                Пересекается с {overlap.time_start}–{overlap.time_end}
              </Text>
            </View>
          ) : null}

          {/* stacked footer: Событие сверху контуром, «Записать клиента» —
              акцент в зоне большого пальца (web parity) */}
          <View className="gap-2 px-4 pt-1">
            <Button
              label="Событие"
              variant="secondary"
              onPress={() => confirm("event")}
            />
            <Button label="Записать клиента" onPress={() => confirm("work")} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
