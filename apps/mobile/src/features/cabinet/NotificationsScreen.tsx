import { Fragment, useEffect, useRef } from "react";
import { Linking, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  Bell,
  CalendarClock,
  CalendarDays,
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
import { cancelManualAppointmentReminder } from "@/features/calendar/reminders";
import { chooseOption } from "@/lib/choose";
import {
  getNotificationsModule,
  reconcileBabunNotifications,
} from "@/lib/notifications";
import { useThemeColors } from "@/theme/colors";

import { useDevicePermission, useDeviceReminders } from "./device-notifications";
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
    if (source.kind === "appointment" || source.kind === "event") {
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
    </Screen>
  );
}
