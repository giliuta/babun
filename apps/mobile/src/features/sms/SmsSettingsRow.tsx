import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { useSmsAccount } from "@/features/sms/sms-account";
import { euro } from "@/features/sms/sms-words";

// СТРОКА «SMS» В НАСТРОЙКАХ КАЛЕНДАРЯ (STORY-089). Кабинет → настройки
// клиентов (24.09) → настройки календаря: владелец 29.09 «перенеси SMS в
// календарь, в настройки — не в клиентах, а в календаре». SMS уходят по
// записям календаря, и у настройки одна дверь. Страница `/calendar/sms`:
// баланс, отправка через сервис по командам, автоматические SMS, шаблоны и
// история.
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
      onPress={() => router.push("/calendar/sms" as Href)}
    />
  );
}
