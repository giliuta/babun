import { useLocalSearchParams } from "expo-router";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import {
  AnalyticsScreen as InsightsScreen,
  type AnalyticsStart,
} from "@/features/finances/analytics/AnalyticsScreen";
import { analyticsStartPeriod } from "@/features/finances/analytics/start-period";
import { useBusinessClock } from "@/features/finances/home/use-business-clock";

// «АНАЛИТИКА» (бывшая «Сводка») — экран живёт в `features/finances/analytics`
// (разрезы по услугам, мастерам и месяцам). Этот файл — только адрес и ворота компании.
//
// АНАЛИТИКА КЛИЕНТОВ ОТКРЫВАЕТСЯ ИЗ ВКЛАДКИ «КЛИЕНТЫ», А ТАМ КОМПАНИЯ СВОЯ.
// Кабинет смотрит на компанию УСТРОЙСТВА, а вкладка «Клиенты» — общая
// страница: в «Команде 1» её список и её шапка — про свою компанию
// (STORY-082). Поэтому шапка клиентов передаёт свою компанию в `?tenant=`, и
// тогда экран берёт её источником. Без хвоста — как было: компания
// устройства.
//
// «ФИНАНСЫ» ПЕРЕДАЮТ СВОЙ ПЕРИОД: `?period=` (и `from`/`to` у своего
// периода) — аналитика открывается на том же периоде. Команду не передают:
// аналитика всегда открывается на всей компании. Пресет строится по часам
// компании (`analyticsStartPeriod`).

export default function InsightsRoute() {
  const { tenant, period, from, to } = useLocalSearchParams<{
    tenant?: string;
    period?: string;
    from?: string;
    to?: string;
  }>();
  const { businessNow } = useBusinessClock();
  const start: AnalyticsStart = {
    period: analyticsStartPeriod({ period, from, to }, businessNow),
  };
  if (!tenant) return <InsightsScreen start={start} />;
  return (
    <ClientsCompanyRoute kind="tab">
      <InsightsScreen start={start} />
    </ClientsCompanyRoute>
  );
}
