import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { AlertTriangle, X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { findOverlap } from "@babun/shared/common/utils/appointment-overlap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  addMinutesHM,
  formatHM,
  formatYMD,
  humanDay,
  parseHM,
  parseYMD,
} from "@/features/appointments/helpers";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";

// «Перенести» одним экраном (web RescheduleSheet по смыслу): дата inline-
// календарём + время начала, длительность сохраняется автоматически
// (конец = старт + прежняя длительность, кламп к 23:59 через addMinutesHM —
// визит через полночь бронируется двумя записями, как и в шите записи).
// Пересечение с другой записью бригады предупреждает, но НЕ блокирует
// (web parity: диспетчер иногда ставит внахлёст сознательно).
export function RescheduleSheet({
  appointment,
  appointments,
  onClose,
}: {
  /** Запись на перенос (null = закрыт). */
  appointment: Appointment | null;
  /** Видимый набор записей — проверка пересечения. */
  appointments: Appointment[];
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data: calSettings } = useCalendarSettings();
  const updateAppt = useUpdateAppointment();

  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("");
  useEffect(() => {
    if (!appointment) return;
    setDate(appointment.date);
    setTimeStart(appointment.time_start);
  }, [appointment]);

  // Длительность исходной записи в минутах (мусор во времени → час).
  const durationMin = useMemo(() => {
    if (!appointment) return 60;
    const [sh, sm] = appointment.time_start.split(":").map(Number);
    const [eh, em] = appointment.time_end.split(":").map(Number);
    const d = (eh || 0) * 60 + (em || 0) - ((sh || 0) * 60 + (sm || 0));
    return d > 0 ? d : 60;
  }, [appointment]);
  const timeEnd = timeStart ? addMinutesHM(timeStart, durationMin) : "";

  const overlap = useMemo(
    () =>
      appointment && date && timeStart
        ? findOverlap(
            { ...appointment, date, time_start: timeStart, time_end: timeEnd },
            // Виртуальные вхождения СОБСТВЕННОЙ серии — не конфликт:
            // перенос seed на дату другого вхождения ложно предупреждал
            // «пересекается сам с собой».
            appointments.filter(
              (a) =>
                (a as { virtualParentId?: string }).virtualParentId !==
                appointment.id,
            ),
          )
        : null,
    [appointment, appointments, date, timeStart, timeEnd],
  );

  // Меню не открывает виртуальные вхождения повтора, но защищаемся и на
  // входе: у виртуала синтетический id, мутация по нему невалидна.
  if (
    appointment &&
    (appointment as { virtualParentId?: string }).virtualParentId
  ) {
    return null;
  }

  const unchanged =
    !!appointment &&
    date === appointment.date &&
    timeStart === appointment.time_start;

  const confirm = () => {
    if (!appointment || !date || !timeStart) return;
    const prev = {
      date: appointment.date,
      time_start: appointment.time_start,
      time_end: appointment.time_end,
    };
    updateAppt.mutate(
      {
        id: appointment.id,
        patch: { date, time_start: timeStart, time_end: timeEnd },
      },
      {
        onSuccess: () => {
          haptics.success();
          toast(`Перенесено: ${humanDay(date)}, ${timeStart}`, "success", {
            label: "Отменить",
            onPress: () =>
              updateAppt.mutate({ id: appointment.id, patch: prev }),
          });
        },
        onError: () => toast("Не удалось перенести", "error"),
      },
    );
    onClose();
  };

  // «Шаг сетки» календаря задаёт шаг колеса минут; iOS-пикер принимает
  // максимум 30 — шаг 60 сводим к ближайшему делителю.
  const step = calSettings?.gridStep ?? 30;
  const minuteInterval = step === 60 ? 30 : step;

  return (
    <Modal
      visible={appointment != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable
          className="flex-1"
          onPress={onClose}
          accessibilityLabel="Закрыть"
        />
        <View
          className="overflow-hidden rounded-t-3xl"
          style={{
            backgroundColor: t.canvas,
            paddingBottom: insets.bottom + 8,
          }}
        >
          {/* header */}
          <View
            className="flex-row items-center justify-between border-b px-4 py-3"
            style={{ borderColor: t.separator }}
          >
            <View>
              <Text className="text-[17px] font-semibold" style={{ color: t.ink }}>
                Перенести запись
              </Text>
              {appointment ? (
                <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
                  Сейчас: {humanDay(appointment.date)} ·{" "}
                  {appointment.time_start}–{appointment.time_end}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Закрыть">
              <X color={t.faint} size={ICON.md} />
            </Pressable>
          </View>

          {/* новая дата — inline-календарь */}
          <View className="px-3">
            <DateTimePicker
              value={date ? parseYMD(date) : new Date()}
              mode="date"
              display="inline"
              accentColor={t.accent}
              onChange={(_, d) => d && setDate(formatYMD(d))}
            />
          </View>

          {/* новое время начала; конец пересчитывается сам */}
          <View
            className="mx-4 flex-row items-center justify-between border-t py-2"
            style={{ borderColor: t.separator }}
          >
            <Text className="text-base" style={{ color: t.ink }}>
              Время
            </Text>
            <View className="flex-row items-center">
              <DateTimePicker
                value={timeStart ? parseHM(timeStart) : new Date()}
                mode="time"
                display="compact"
                minuteInterval={minuteInterval}
                onChange={(_, d) => d && setTimeStart(formatHM(d))}
              />
              <Text className="pl-2 text-[13px] tabular-nums" style={{ color: t.faint }}>
                до {timeEnd}
              </Text>
            </View>
          </View>
          <Text className="px-4 pb-1 text-[12px]" style={{ color: t.faint }}>
            Длительность сохраняется
          </Text>

          {/* пересечение — предупреждаем, не блокируем (web parity) */}
          {overlap ? (
            <View
              className="mx-4 mb-1 mt-1 flex-row items-start gap-2 rounded-[14px] border px-3 py-2.5"
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

          <View className="px-4 pt-2">
            <Button
              label="Перенести"
              onPress={confirm}
              disabled={unchanged || !date || !timeStart}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
