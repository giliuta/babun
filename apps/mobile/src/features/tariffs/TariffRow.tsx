import { useRouter, type Href } from "expo-router";
import { BadgeCheck } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { accountHref } from "@/features/cabinet/CabinetAccountRoute";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { tierLine } from "./tiers";
import { TARIFF_HREF, useTariff } from "./use-tariff";

// СТРОКА «ТАРИФ» В КАБИНЕТЕ (владелец 01.10: «выбор тарифа — в кабинете»).
// Подпись — живое состояние: «Макс», «Про · пробный, ещё 9 дней», «Без
// тарифа». `tenantId` — строка блока аккаунта, который пригласил (04.10):
// его тариф и его страница. В приложении из магазина — только имя тарифа,
// без отсчёта пробного (`pay-here.ts`).
export function TariffRow({ tenantId }: { tenantId?: string } = {}) {
  const router = useRouter();
  const { state } = useTariff();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.blue}
      icon={BadgeCheck}
      title="Тариф"
      sub={state.forever ? `${tierLine(state.tier, null)} · навсегда` : tierLine(state.tier, state.trial, CAN_PAY_HERE)}
      onPress={() => router.push(tenantId ? (accountHref("/cabinet/tariff", tenantId) as Href) : TARIFF_HREF)}
    />
  );
}
