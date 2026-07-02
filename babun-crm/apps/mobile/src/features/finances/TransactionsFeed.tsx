import { useMemo } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { formatEUR, formatEURSigned } from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import type { Team } from "@/features/reference/queries";
import type { Service } from "@/features/services/queries";

// Day-grouped operations feed — port of the web TransactionsFeed
// (mockup «Вариант 3»): colored pill on the left, «время · клиент» over
// the description, amount on the right. An income tied to an appointment
// titles itself with the visit's SERVICES and its tap jumps to the
// client card; everything else opens the tx popup.
export function TransactionsFeed({
  transactions,
  accounts,
  teams,
  categories,
  clients,
  appointments,
  services,
  title,
  onReset,
  onTxTap,
  onClientTap,
}: {
  transactions: FinanceTransaction[];
  accounts: Account[];
  teams: Team[];
  categories: FinanceCategory[];
  clients: Client[];
  appointments: Appointment[];
  services: Service[];
  /** Section eyebrow, e.g. «Операции · 12». */
  title: string;
  /** Shown as an «Все» reset link when the feed is filtered. */
  onReset?: () => void;
  onTxTap: (tx: FinanceTransaction) => void;
  onClientTap: (clientId: string) => void;
}) {
  const t = useThemeColors();

  const lookups = useMemo(
    () => ({
      account: new Map(accounts.map((a) => [a.id, a])),
      team: new Map(teams.map((x) => [x.id, x])),
      category: new Map(categories.map((c) => [c.id, c])),
      client: new Map(clients.map((c) => [c.id, c])),
      appointment: new Map(appointments.map((a) => [a.id, a])),
      service: new Map(services.map((s) => [s.id, s])),
    }),
    [accounts, teams, categories, clients, appointments, services],
  );

  const sections = useMemo(() => {
    const byDate = new Map<string, FinanceTransaction[]>();
    for (const tx of transactions) {
      const arr = byDate.get(tx.occurred_on) ?? [];
      arr.push(tx);
      byDate.set(tx.occurred_on, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({
        title: date,
        // transfers are balance-neutral — excluded from the day net (web
        // groupByDay parity)
        net: data.reduce(
          (s, tx) => (tx.type === "transfer" ? s : s + signedAmount(tx)),
          0,
        ),
        data,
      }));
  }, [transactions]);

  const renderRow = (tx: FinanceTransaction) => {
    const isIn = tx.type === "income" || tx.type === "refund";
    const isEx = tx.type === "expense";
    const isTr = tx.type === "transfer";

    const cat = tx.category_id ? lookups.category.get(tx.category_id) : null;
    const appt = tx.appointment_id
      ? lookups.appointment.get(tx.appointment_id)
      : null;

    // title — the service NAME (visit services > the operation note),
    // not the bare category. Falls back per type (web parity).
    let desc = "";
    if (isIn && appt && appt.service_ids.length > 0) {
      desc = appt.service_ids
        .map((id) => lookups.service.get(id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    }
    if (!desc) {
      desc = isIn
        ? tx.notes || cat?.name || (tx.type === "refund" ? "Возврат" : "Поступление")
        : cat?.name || tx.notes || (isTr ? "Перевод" : "Расход");
    }

    // context line: время · клиент (income) / комментарий (expense)
    let ctx = "";
    if (isIn) {
      const client = tx.client_id ? lookups.client.get(tx.client_id) : null;
      ctx = [appt?.time_start, client?.full_name].filter(Boolean).join(" · ");
    } else if (isEx && cat && tx.notes) {
      ctx = tx.notes;
    }
    if (!ctx) {
      ctx = [
        tx.account_id ? lookups.account.get(tx.account_id)?.name : null,
        tx.team_id ? lookups.team.get(tx.team_id)?.name : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    const barColor = isIn ? t.success : isEx ? t.danger : t.faint;
    const amountColor = isIn ? t.success : isEx ? t.danger : t.sub;
    const sign = isIn || (isTr && tx.amount > 0) ? "+" : "−";

    return (
      <Pressable
        onPress={() =>
          isIn && tx.client_id ? onClientTap(tx.client_id) : onTxTap(tx)
        }
        accessibilityRole="button"
        accessibilityLabel={`${desc}, ${sign}${formatEUR(Math.abs(tx.amount))}`}
        className="flex-row items-center gap-3 px-4 active:opacity-60"
        style={{ backgroundColor: t.surface, minHeight: 56 }}
      >
        <View
          className="rounded-full"
          style={{ width: 6, height: 36, backgroundColor: barColor }}
        />
        <View className="flex-1">
          {ctx ? (
            <Text className="text-xs" style={{ color: t.faint }} numberOfLines={1}>
              {ctx}
            </Text>
          ) : null}
          <Text
            className={`text-[15px] ${isTr ? "font-medium" : "font-semibold"}`}
            style={{ color: isTr ? t.sub : t.ink }}
            numberOfLines={1}
          >
            {desc}
          </Text>
        </View>
        <Text
          className="text-base font-bold tabular-nums"
          style={{ color: amountColor }}
        >
          {sign}
          {formatEUR(Math.abs(tx.amount))}
        </Text>
      </Pressable>
    );
  };

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      keyExtractor={(tx) => tx.id}
      ListHeaderComponent={
        <View className="flex-row items-center px-4 pb-1 pt-2">
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: t.sub }}
          >
            {title}
          </Text>
          {onReset ? (
            <Pressable
              onPress={onReset}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Показать все операции"
              className="ml-auto active:opacity-60"
            >
              <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
                Все
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
      contentContainerStyle={{ paddingBottom: 96 }}
      renderSectionHeader={({ section }) => (
        <View
          className="flex-row items-center justify-between px-4 py-1.5"
          style={{ backgroundColor: t.canvas }}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: t.sub }}
          >
            {humanDay(section.title)}
          </Text>
          <Text
            className="text-xs font-semibold tabular-nums"
            style={{ color: section.net < 0 ? t.danger : t.success }}
          >
            {formatEURSigned(section.net)}
          </Text>
        </View>
      )}
      renderItem={({ item }) => renderRow(item)}
      ItemSeparatorComponent={() => (
        <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
      )}
      ListEmptyComponent={
        <EmptyState
          title="Нет операций за период"
          subtitle="Нажмите + чтобы добавить"
        />
      }
    />
  );
}
