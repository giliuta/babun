import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useSmsAccount } from "@/features/sms/sms-account";

// СТРОКА «SMS» В НАСТРОЙКАХ КАЛЕНДАРЯ (STORY-089; владелец 29.09: «открываю
// Команда 1 → SMS — все шаблоны этой команды»). Ведёт на SMS той команды,
// чьи настройки открыты (`?team=`, как «Услуги» и «Метки»).
//
// Подпись — живое состояние команды: имя отправителя (без него команда
// молчит) и сколько шаблонов.
export function SmsSettingsRow({ teamId }: { teamId: string | null }) {
  const router = useRouter();
  const data = useSmsAccount().data;
  const count = teamId ? (data?.owner?.templateCounts[teamId] ?? 0) : 0;
  const sender = teamId ? data?.senders?.[teamId] : undefined;
  const sub = data
    ? `${sender ?? "Нет имени отправителя"} · ${count > 0 ? formatCountRu(count, ["шаблон", "шаблона", "шаблонов"]) : "Шаблонов нет"}`
    : undefined;

  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={MessageSquare}
      title="SMS"
      sub={sub}
      onPress={() =>
        router.push((teamId ? { pathname: "/calendar/sms", params: { team: teamId } } : "/calendar/sms") as Href)
      }
    />
  );
}
