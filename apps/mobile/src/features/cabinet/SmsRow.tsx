import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useSmsTemplates } from "@/features/settings/sms-templates";

// СТРОКА «SMS» В КАБИНЕТЕ (STORY-089; владелец 24.09: «у них есть
// собственный кабинет отправки СМС»). Это место компании, а не настройка
// раздела: шаблоны, по которым пишут клиентам со своего телефона, а со второй
// волны — баланс, автоматическая отправка по календарям и история.
//
// Подпись — живое состояние (закон Кабинета): сколько шаблонов готово.
export function SmsRow() {
  const router = useRouter();
  const { data: templates = [] } = useSmsTemplates();
  const ready = templates.filter((tpl) => tpl.enabled && tpl.body.trim()).length;

  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={MessageSquare}
      title="SMS"
      sub={ready > 0 ? formatCountRu(ready, ["шаблон", "шаблона", "шаблонов"]) : "Шаблонов нет"}
      onPress={() => router.push("/cabinet/sms-templates" as Href)}
    />
  );
}
