import { Fragment, useEffect, useRef, useState } from "react";
import { Linking, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  Bell,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  PiggyBank,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { PickerSheet } from "@/components/ui/PickerSheet";
import {
  cancelManualAppointmentReminder,
  clearSelfReminder,
} from "@/features/calendar/reminders";
import { reconcileClientReminders } from "@/features/clients/reminders";
import { useClients } from "@/features/clients/queries";
import { chooseOption } from "@/lib/choose";
import {
  getNotificationsModule,
  reconcileBabunNotifications,
} from "@/lib/notifications";
import { useThemeColors } from "@/theme/colors";

import { useDevicePermission, useDeviceReminders } from "./device-notifications";
import {
  CLIENT_TIME_OPTIONS,
  RECORD_REMINDER_OPTIONS,
  clientTimeLabel,
  recordsLabel,
  sameRecordRule,
} from "./notification-prefs";
import { useNotificationPrefs, writeNotificationPrefs } from "./notification-prefs-store";
import {
  permissionRow,
  reminderCanCancel,
  remindersSilenced,
  type DevicePermission,
  type ReminderRow,
  type ReminderSource,
} from "./device-reminders";

// СТРАНИЦА «УВЕДОМЛЕНИЯ» (Кабинет, 2026-09-15). Что в списке и почему строка
// одна на источник — в шапке `device-reminders.ts`.
//
// ВЕРХНЯЯ СТРОКА — разрешение этого iPhone. Пока вопрос не задан, она задаёт его
// системным окном; после отказа iOS спросить второй раз не даёт, и строка ведёт
// в настройки iPhone. Разрешили — сверка ставит напоминания, которые без
// разрешения ждали очереди.
//
// СТРОКА НАПОМИНАНИЯ — дверь в его источник. Ручное напоминание записи ещё и
// отменяется (лист выбора); событие и клиент открываются сразу.

const SOURCE_ICON: Record<ReminderSource["kind"], LucideIcon> = {
  appointment: CalendarClock,
  self: BellRing,
  auto: CalendarCheck,
  event: CalendarDays,
  client: UserRound,
  other: Bell,
};

// Вшитый отступ разделителя: поле строки 16 + бокс нейтрального глифа 20 + зазор 12.
const NEUTRAL_ROW_INSET = 48;

export function NotificationsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const permissionQuery = useDevicePermission();
  const permission = permissionQuery.data;
  const { days, count } = useDeviceReminders();
  const permissionView = permission ? permissionRow(permission) : null;
  const prefs = useNotificationPrefs();
  const { data: clients = [] } = useClients();
  const [picker, setPicker] = useState<"records" | "clients" | null>(null);

  // Правило выбрано, а iPhone ещё не спрашивали — спросить сейчас: это явное
  // действие человека, иначе напоминание молча не зазвонит.
  const askIfUndetermined = async () => {
    if (permission !== "undetermined") return;
    try {
      await getNotificationsModule()?.requestPermissionsAsync();
    } catch {
      // Метода нет в этой сборке — перечитка покажет «недоступны».
    }
    void permissionQuery.refetch();
  };

  const seenPermission = useRef<DevicePermission | undefined>(undefined);
  useEffect(() => {
    if (
      permission === "granted" &&
      seenPermission.current !== undefined &&
      seenPermission.current !== "granted"
    ) {
      void reconcileBabunNotifications().catch(() => {});
    }
    if (permission) seenPermission.current = permission;
  }, [permission]);

  const onPermission = async (action: "request" | "settings") => {
    if (action === "settings") {
      void Linking.openSettings();
      return;
    }
    try {
      await getNotificationsModule()?.requestPermissionsAsync();
    } catch {
      // Метода нет в этой сборке — перечитка покажет «недоступны».
    }
    void permissionQuery.refetch();
  };

  const openSource = (source: ReminderSource) => {
    if (
      source.kind === "appointment" ||
      source.kind === "event" ||
      source.kind === "self" ||
      source.kind === "auto"
    ) {
      router.push({
        pathname: "/",
        params: {
          appointmentId: source.appointmentId,
          date: source.date,
          ...(source.teamId ? { teamId: source.teamId } : {}),
        },
      });
    } else if (source.kind === "client") {
      router.push({
        pathname: "/(dashboard)/clients/[id]",
        params: { id: source.clientId },
      });
    }
  };

  const onReminder = async (row: ReminderRow) => {
    if (!reminderCanCancel(row.source)) {
      openSource(row.source);
      return;
    }
    const choice = await chooseOption(row.title, [
      { label: "Открыть в календаре" },
      { label: "Отменить напоминание", destructive: true },
    ]);
    if (choice === 0) {
      openSource(row.source);
    } else if (choice === 1 && row.source.kind === "appointment") {
      await cancelManualAppointmentReminder(row.source.appointmentId);
      toast("Напоминание отменено");
    } else if (choice === 1 && row.source.kind === "self") {
      await clearSelfReminder(row.source.appointmentId);
      toast("Напоминание отменено");
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Уведомления" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.orange}
            icon={Bell}
            title="Уведомления на iPhone"
            sub={permissionView?.sub}
            subColor={
              permission && remindersSilenced(permission, count)
                ? t.warning
                : undefined
            }
            onPress={
              permissionView?.action
                ? () => void onPermission(permissionView.action!)
                : undefined
            }
          />
        </SectionCard>

        {/* НАСТРОЙКИ НАПОМИНАНИЙ ЭТОГО ТЕЛЕФОНА (владелец 03.10: «страница
            уведомления — настройки уведомлений»). */}
        <SectionCard title="Напоминания">
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={CalendarCheck}
            title="О записях"
            sub={recordsLabel(prefs.records)}
            onPress={() => setPicker("records")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={UserRound}
            title="О клиентах"
            sub={clientTimeLabel(prefs.clientTime)}
            onPress={() => setPicker("clients")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.green}
            icon={PiggyBank}
            title="Бюджет категорий"
            sub={prefs.budget ? "Сообщать о 80% и 100%" : "Не сообщать"}
            toggle={{
              value: prefs.budget,
              onChange: (value) => {
                writeNotificationPrefs({ budget: value });
              },
            }}
          />
        </SectionCard>

        {days.length === 0 ? (
          <EmptyState title="Напоминаний нет" />
        ) : (
          days.map((day) => (
            <SectionCard key={day.key} title={day.title}>
              {day.rows.map((row, index) => (
                <Fragment key={row.key}>
                  {index > 0 ? <Divider inset={NEUTRAL_ROW_INSET} /> : null}
                  <SettingsRow
                    tile="neutral"
                    icon={SOURCE_ICON[row.source.kind]}
                    title={row.title}
                    sub={row.sub || undefined}
                    value={row.time}
                    onPress={
                      row.source.kind === "other"
                        ? undefined
                        : () => void onReminder(row)
                    }
                  />
                </Fragment>
              ))}
            </SectionCard>
          ))
        )}
      </ScrollView>

      <PickerSheet
        visible={picker === "records"}
        title="Напоминать о записях"
        selectedId={prefs.records ? recordsLabel(prefs.records) : "off"}
        items={RECORD_REMINDER_OPTIONS.map((rule) => ({
          id: rule ? recordsLabel(rule) : "off",
          label: recordsLabel(rule),
          icon: rule ? CalendarCheck : Bell,
          color: t.accent,
          onPress: () => {
            if (sameRecordRule(rule, prefs.records)) return;
            writeNotificationPrefs({ records: rule });
            if (rule) void askIfUndetermined();
          },
        }))}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === "clients"}
        title="Напоминать о клиентах"
        selectedId={prefs.clientTime ?? "off"}
        items={CLIENT_TIME_OPTIONS.map((time) => ({
          id: time ?? "off",
          label: clientTimeLabel(time),
          icon: time ? UserRound : Bell,
          color: t.accent,
          onPress: () => {
            if (time === prefs.clientTime) return;
            writeNotificationPrefs({ clientTime: time });
            // Напоминания уже стоят — пересобрать их под новое время.
            void reconcileClientReminders(clients).catch(() => {});
            if (time) void askIfUndetermined();
          },
        }))}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}
