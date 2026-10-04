import { useRouter, type Href } from "expo-router";
import { Receipt } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useThemeColors } from "@/theme/colors";

import { accountHref } from "./CabinetAccountRoute";
import { latestPaymentLine } from "./tariff-payments";
import { LATEST_PAYMENTS_SAMPLE, useTariffPayments } from "./use-tariff-payments";

// «ОПЛАТЫ ТАРИФА» — СТРОКА-ДВЕРЬ КАБИНЕТА (владелец 03.10: «оплаты тарифа —
// да, надо»). Подпись — последняя оплата; если последней оказалась неудачная,
// об этом сказано красным: деньги не списались, тариф под угрозой. Пока
// читается — подписи нет, как у соседних дверей. `tenantId` — строка блока
// аккаунта, который пригласил (04.10).
export function TariffPaymentsRow({ tenantId }: { tenantId?: string } = {}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data } = useTariffPayments(LATEST_PAYMENTS_SAMPLE);
  const latest = data ? (data[0] ?? null) : undefined;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.blue}
      icon={Receipt}
      title="Оплаты тарифа"
      sub={latest === undefined ? undefined : latestPaymentLine(latest, Date.now())}
      subColor={latest?.failed ? t.danger : undefined}
      onPress={() => router.push((tenantId ? accountHref("/cabinet/payments", tenantId) : "/cabinet/payments") as Href)}
    />
  );
}
