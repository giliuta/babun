import { useRouter } from "expo-router";
import { BadgeCheck } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useAccountGate, useAccountScope } from "@/session/account-scope";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { tariffStatus } from "@/session/tiers";
import { calendarTariffHref, useCalendarTariff } from "./use-tariff";

// СТРОКА «ТАРИФ» В ШЕСТЕРЁНКЕ КАЛЕНДАРЯ — тариф ЭТОГО календаря: у каждого
// календаря своя оплата. Подпись — живое состояние: «Оплачен до 27.11»,
// «Пробный · ещё 9 дней», «Не оплачен», «Навсегда». В приложении из
// магазина — без отсчёта пробного (`pay-here.ts`).
//
// Видит владелец и партнёр с правом «Тариф» (`useSeesTariff`): видимость
// решает вызывающий — у шестерёнки карточка собирается из видимых строк.
export function TariffRow({ teamId }: { teamId: string }) {
  const router = useRouter();
  const { state, periodEnd, loading } = useCalendarTariff(teamId);
  return (
    <SettingsRow
      tile={SETTINGS_TILE.blue}
      icon={BadgeCheck}
      title="Тариф"
      sub={loading ? undefined : tariffStatus(state, periodEnd, CAN_PAY_HERE)}
      onPress={() => router.push(calendarTariffHref(teamId))}
    />
  );
}

/** Видит ли человек тариф календаря: владелец или партнёр с правом «Тариф». */
export function useSeesTariff(): boolean {
  const owner = useAccountScope().viewRole === "owner";
  const gate = useAccountGate("cabinet.tariff");
  return owner || gate === "read" || gate === "write";
}
