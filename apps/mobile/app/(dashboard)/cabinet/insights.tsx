import { useLocalSearchParams } from "expo-router";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import {
  AnalyticsScreen as InsightsScreen,
  type AnalyticsStart,
} from "@/features/finances/analytics/AnalyticsScreen";
import { makePeriod, type PeriodKind } from "@/features/finances/period";

// «АНАЛИТИКА» (бывшая «Сводка») — экран живёт в `features/finances/analytics`
// (владелец 2026-09-24: «градация по услугам, по всем мастерам, по месяцам —
// продумай на максимум»). Этот файл — только адрес и ворота компании.
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
// аналитика всегда открывается на всей компании (владелец 2026-09-24).
const KINDS: readonly PeriodKind[] = [
  "today", "yesterday", "week", "lastweek", "month", "lastmonth",
  "quarter", "lastquarter", "year", "lastyear",
];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default function InsightsRoute() {
  const { tenant, period, from, to } = useLocalSearchParams<{
    tenant?: string;
    period?: string;
    from?: string;
    to?: string;
  }>();
  const start: AnalyticsStart = {
    period:
      period === "custom" && from && to && YMD.test(from) && YMD.test(to) && from <= to
        ? { preset: "custom", from, to }
        : KINDS.includes(period as PeriodKind)
          ? makePeriod(period as PeriodKind)
          : null,
  };
  if (!tenant) return <InsightsScreen start={start} />;
  return (
    <ClientsCompanyRoute kind="tab">
      <InsightsScreen start={start} />
    </ClientsCompanyRoute>
  );
}
