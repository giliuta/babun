import { useRouter, type Href } from "expo-router";
import { Bell } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useThemeColors } from "@/theme/colors";

import { useDevicePermission, useDeviceReminders } from "./device-notifications";
import { notificationsSummary, remindersSilenced } from "./device-reminders";

// «УВЕДОМЛЕНИЯ» — СТРОКА-ДВЕРЬ КАБИНЕТА (разрез 007 + 008, 2026-09-15; место в
// корне выбирает 007). Подпись — живое состояние этого телефона: разрешены ли
// уведомления и сколько напоминаний ждут. Янтарь — только когда напоминания
// есть, а зазвонить им не дадут. Плитка оранжевая: в словаре пигментов это
// «время», а напоминание — ровно про время.
export function NotificationsRow() {
  const t = useThemeColors();
  const router = useRouter();
  const permission = useDevicePermission().data;
  const { count } = useDeviceReminders();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.orange}
      icon={Bell}
      title="Уведомления"
      sub={permission ? notificationsSummary(permission, count) : undefined}
      subColor={
        permission && remindersSilenced(permission, count) ? t.warning : undefined
      }
      onPress={() => router.push("/cabinet/notifications" as Href)}
    />
  );
}
