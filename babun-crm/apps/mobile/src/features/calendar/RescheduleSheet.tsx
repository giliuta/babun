import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { AlertTriangle } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
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
import { haptics } from "@/lib/haptics";
import {
  cancelAppointmentReminders,
  syncEventAppointmentReminders,
} from "@/features/calendar/reminders";
import {
  rescheduleWarning,
  type RescheduleWorkBand,
} from "@/features/calendar/reschedule-warning";

// «Перенести» одним экраном (web RescheduleSheet по смыслу): дата inline-
// календарём + время начала, длительность сохраняется автоматически
// (конец = старт + прежняя длительность, кламп к 23:59 через addMinutesHM —
// визит через полночь бронируется двумя записями, как и в шите записи).
// Пересечение с другой записью команды предупреждает, но НЕ блокирует
// (web parity: диспетчер иногда ставит внахлёст сознательно).
export function RescheduleSheet({
  appointment,
  appointments,
  workBandFor,
  bufferMinutes = 0,
  timeZone = "Europe/Nicosia",
  onClose,
}: {
  /** Запись на перенос (null = закрыт). */
  appointment: Appointment | null;
  /** Видимый набор записей — проверка пересечения. */
  appointments: Appointment[];
  workBandFor?: (dateYmd: string) => RescheduleWorkBand | null | undefined;
  bufferMinutes?: number;
  timeZone?: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
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

  const warning = useMemo(
    () =>
      appointment && date && timeStart
        ? rescheduleWarning(
            appointment,
            { date, timeStart, timeEnd },
            appointments,
            workBandFor?.(date),
            bufferMinutes,
          )
        : null,
    [appointment, appointments, date, timeStart, timeEnd, workBandFor, bufferMinutes],
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
          if (appointment.kind === "event" || appointment.kind === "personal") {
            void syncEventAppointmentReminders(
              { ...appointment, date, time_start: timeStart, time_end: timeEnd },
              timeZone,
            );
          } else {
            void cancelAppointmentReminders(appointment.id);
          }
          toast(`Перенесено: ${humanDay(date)}, ${timeStart}`, "success", {
            label: "Отменить",
            onPress: () =>
              updateAppt.mutate(
                { id: appointment.id, patch: prev },
                {
                  onSuccess: () => {
                    // Зеркало прямого пути: напоминания события снова целятся
                    // в исходный слот (appointment и есть до-переносное
                    // состояние), иначе до рефетча пуш стрелял бы по
                    // отменённому времени.
                    if (
                      appointment.kind === "event" ||
                      appointment.kind === "personal"
                    ) {
                      void syncEventAppointmentReminders(appointment, timeZone);
                    }
                  },
                  // Без колбэка откат падал молча: options-level onError
                  // хука гасит глобальный алерт MutationCache.
                  onError: () => toast("Не удалось вернуть запись", "error"),
                },
              ),
          });
        },
        onError: () => toast("Не удалось перенести", "error"),
      },
    );
    onClose();
  };

  return (
    <BottomSheet padded={false} visible={appointment != null} onClose={onClose}>
      {/* Тело скроллится, CTA прибит снизу: при AX-шрифтах inline-календарь
          + строки не выталкивают «Перенести» за край листа. */}
      <ScrollView bounces={false} style={{ flexShrink: 1 }}>
        {/* header */}
        <View
          className="border-b px-4 pb-3 pt-1"
          style={{ borderColor: t.separator }}
        >
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

        {/* новая дата — inline-календарь */}
        <View className="px-3">
          <DateTimePicker
            themeVariant="light"
            value={date ? parseYMD(date) : new Date()}
            mode="date"
            display="inline"
            locale="ru-RU"
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
            {/* 5 мин — как на экране создания /book и в AppointmentSheet.
                Раньше шаг колеса брался из «Шага сетки»
                (30 мин), и запись, созданную на 11:35, физически нельзя было
                перенести обратно на 11:35: две двери в одно время разной
                ширины. */}
            <DateTimePicker
              themeVariant="light"
              value={timeStart ? parseHM(timeStart) : new Date()}
              mode="time"
              display="compact"
              locale="ru-RU"
              minuteInterval={5}
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
        {warning ? (
          <View
            className="mx-4 mb-1 mt-1 flex-row items-start gap-2 rounded-[10px] border px-3 py-2.5"
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
              {warning}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        className="px-4 pt-2"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <Button
          label="Перенести"
          onPress={confirm}
          disabled={unchanged || !date || !timeStart}
        />
      </View>
    </BottomSheet>
  );
}
