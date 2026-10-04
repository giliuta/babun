import { useMemo } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { formatEUR } from "@babun/shared/common/utils/money";

import { NavRow, RowGroup } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { payoutDay, payoutsByMonth } from "@/features/access/master-page/partner-facts";
import { usePartnerPayouts } from "@/features/access/master-page/use-partner-payouts";
import { formatShortDateRu } from "@/features/clients/format";
import { useFinanceCategories } from "@/features/finances/queries";
import { useMaster } from "@/features/reference/queries";

// «ВЫПЛАТЫ» ПАРТНЁРА (владелец 04.10, мозговой штурм страницы партнёра).
// Строка «Выплачено» на его странице ведёт сюда: все расходы, где он стоит в
// «Кому», по месяцам — свежие сверху, у месяца итог. Только смотреть:
// операция правится там, где её внесли, — в «Финансах».

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function monthTitle(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const name = MONTHS[(m ?? 1) - 1] ?? ym;
  return y === new Date().getFullYear() ? name : `${name} ${y}`;
}

export default function PartnerPayoutsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const cardQuery = useMaster(params.id);
  const card = cardQuery.data ?? null;
  const payouts = usePartnerPayouts(card?.id);
  const { data: categories = [] } = useFinanceCategories();
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const months = useMemo(() => payoutsByMonth(payouts.data ?? []), [payouts.data]);

  const header = <ScreenHeader title="Выплаты" subtitle={card?.full_name || undefined} />;
  if (cardQuery.isLoading || payouts.isLoading) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (payouts.isError) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить выплаты"
          action={{ label: "Повторить", onPress: () => void payouts.refetch() }}
        />
      </Screen>
    );
  }
  if (months.length === 0) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState fill title="Выплат пока нет" />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {months.map((month) => (
          <RowGroup key={month.month} title={`${monthTitle(month.month)} · ${formatEUR(month.total)}`}>
            {month.rows.map((row, i) => (
              <NavRow
                key={row.id}
                label={formatShortDateRu(payoutDay(row))}
                value={[
                  (row.category_id && categoryName.get(row.category_id)) || row.notes || "Выплата",
                  formatEUR(Math.abs(Number(row.amount) || 0)),
                ].join(" · ")}
                separated={i > 0}
              />
            ))}
          </RowGroup>
        ))}
      </ScrollView>
    </Screen>
  );
}
