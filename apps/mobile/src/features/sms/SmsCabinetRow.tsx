import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";
import { balanceWarning, useSmsAccount } from "./sms-account";
import { euro } from "./sms-words";
import { accountHref } from "@/features/cabinet/CabinetAccountRoute";

// СТРОКА «SMS» В КАБИНЕТЕ (STORY-089; владелец 29.09: «баланс и пополнение —
// это всё будет Кабинет SMS»). Деньги компании — не настройка раздела, как и
// «Архив», поэтому живут в Кабинете; шаблоны команд — за шестерёнкой
// календаря. Справа — баланс. `tenantId` — строка блока аккаунта, который
// пригласил (04.10): его баланс и его страница.
export function SmsCabinetRow({ tenantId }: { tenantId?: string } = {}) {
  const t = useThemeColors();
  const router = useRouter();
  const data = useSmsAccount().data;
  const owner = data?.owner;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={MessageSquare}
      title="SMS"
      value={owner ? euro(owner.balanceCents) : undefined}
      sub={balanceWarning(data, CAN_PAY_HERE) ?? undefined}
      valueColor={balanceWarning(data, CAN_PAY_HERE) ? t.warning : undefined}
      valueQuiet={!owner || (owner.balanceCents === 0 && !balanceWarning(data, CAN_PAY_HERE))}
      onPress={() => router.push((tenantId ? accountHref("/cabinet/sms", tenantId) : "/cabinet/sms") as Href)}
    />
  );
}
