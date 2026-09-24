import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { useSmsAccount } from "@/features/sms/sms-account";
import { euro } from "@/features/sms/sms-words";

// СТРОКА «SMS» В НАСТРОЙКАХ КЛИЕНТОВ (STORY-089). Сначала стояла в Кабинете
// («собственный кабинет отправки СМС»), владелец 24.09: «давай добавим это
// в настройки к клиентам» — SMS пишут клиентам, и у настройки одна дверь в
// её разделе. Страница `/clients/sms`: баланс, отправка через сервис по
// календарям, автоматические SMS, шаблоны и история.
//
// Подпись — живое состояние: баланс и сколько шаблонов готово.
export function SmsSettingsRow() {
  const router = useRouter();
  const { data: templates = [] } = useSmsTemplates();
  const owner = useSmsAccount().data?.owner;
  const ready = templates.filter((tpl) => tpl.enabled && tpl.body.trim()).length;
  const parts = [
    owner ? euro(owner.balanceCents) : null,
    ready > 0 ? formatCountRu(ready, ["шаблон", "шаблона", "шаблонов"]) : "Шаблонов нет",
  ].filter(Boolean);

  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={MessageSquare}
      title="SMS"
      sub={parts.join(" · ")}
      onPress={() => router.push("/clients/sms" as Href)}
    />
  );
}
