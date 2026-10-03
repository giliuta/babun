import { useRouter, type Href } from "expo-router";
import { History } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { shortDate } from "./change-log";
import { useChangeLogToday } from "./use-change-log";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» — СТРОКА-ДВЕРЬ КАБИНЕТА (владелец 03.10). Подпись —
// живое состояние: сколько изменений сегодня, а без них — когда было
// последнее.
export function HistoryRow() {
  const router = useRouter();
  const { data } = useChangeLogToday();
  const sub = !data
    ? undefined
    : data.today > 0
      ? `Сегодня ${formatCountRu(data.today, ["изменение", "изменения", "изменений"])}`
      : data.lastAt
        ? `Последнее — ${shortDate(localDate(data.lastAt))}`
        : "Изменений пока нет";
  return (
    <SettingsRow
      tile={SETTINGS_TILE.teal}
      icon={History}
      title="История изменений"
      sub={sub}
      onPress={() => router.push("/cabinet/history" as Href)}
    />
  );
}

/** Метка времени сервера → дата на этом телефоне («2026-10-03»). */
function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
