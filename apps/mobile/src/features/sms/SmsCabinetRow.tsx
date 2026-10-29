import { useRouter, type Href } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";
import { balanceWarning, useSmsAccount } from "./sms-account";
import { euro } from "./sms-words";
import { accountHref } from "@/session/CabinetAccountRoute";

// СТРОКА «SMS» В КАБИНЕТЕ (баланс и пополнение). Деньги компании — не настройка раздела, как и
// «Архив», поэтому живут в Кабинете; шаблоны команд — за шестерёнкой
// календаря. Справа — баланс. `tenantId` — строка блока аккаунта, который
// пригласил: его баланс и его страница.
export function SmsCabinetRow({ tenantId }: { tenantId?: string } = {}) {
  const t = useThemeColors();
  const router = useRouter();
  const data = useSmsAccount().data;
  const owner = data?.owner;
  const warning = balanceWarning(data, CAN_PAY_HERE);
  // ПУСТОЙ БАЛАНС — СЛОВАМИ, А НЕ ГОЛЫМ «€0»: ноль справа читался как цена
  // строки. Где платить можно (`CAN_PAY_HERE`), подпись говорит, что сделать;
  // в приложении из магазина остаётся тихий ноль.
  const empty = !!owner && owner.balanceCents === 0 && !warning && CAN_PAY_HERE;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={MessageSquare}
      title="SMS"
      value={owner && !empty ? euro(owner.balanceCents) : undefined}
      sub={warning ?? (empty ? "Пополните баланс" : undefined)}
      valueColor={warning ? t.warning : undefined}
      valueQuiet={!owner || (owner.balanceCents === 0 && !warning)}
      onPress={() => router.push((tenantId ? accountHref("/cabinet/sms", tenantId) : "/cabinet/sms") as Href)}
    />
  );
}
