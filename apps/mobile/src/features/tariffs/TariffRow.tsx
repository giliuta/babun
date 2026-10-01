import { useRouter } from "expo-router";
import { BadgeCheck } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { tierLine } from "./tiers";
import { TARIFF_HREF, useTariff } from "./use-tariff";

// СТРОКА «ТАРИФ» В КАБИНЕТЕ (владелец 01.10: «выбор тарифа — в кабинете»).
// Подпись — живое состояние: «Макс», «Про · пробный, ещё 9 дней», «Без
// тарифа».
export function TariffRow() {
  const router = useRouter();
  const { state } = useTariff();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.blue}
      icon={BadgeCheck}
      title="Тариф"
      sub={state.forever ? `${tierLine(state.tier, null)} · навсегда` : tierLine(state.tier, state.trial)}
      onPress={() => router.push(TARIFF_HREF)}
    />
  );
}
