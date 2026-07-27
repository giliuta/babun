import { useMemo } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
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
// «ЧЧ:ММ» из ISO-времени — фолбэк контекста дохода (web hhmm parity).
function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

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
  contextMode = "default",
  scroll = true,
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
  /** «team» — лента одного счёта: имя счёта в контексте избыточно,
   *  фолбэк-строка показывает только команду. */
  contextMode?: "default" | "team";
  /** false — плоский рендер для вложения в родительский ScrollView
   *  (деталь счёта); SectionList внутри ScrollView не живёт. */
  scroll?: boolean;
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
    const isIncome = tx.type === "income";
    const isRefund = tx.type === "refund";
    const isIn = isIncome || isRefund;
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
      // Доход без привязанной записи — время создания операции (web parity).
      const time = appt?.time_start || hhmm(tx.created_at);
      ctx = [time, client?.full_name].filter(Boolean).join(" · ");
    } else if (isEx && cat && tx.notes) {
      ctx = tx.notes;
    }
    if (!ctx) {
      ctx = [
        contextMode === "team" || !tx.account_id
          ? null
          : lookups.account.get(tx.account_id)?.name,
        tx.team_id ? lookups.team.get(tx.team_id)?.name : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    const barColor = isIncome ? t.success : isRefund || isEx ? t.danger : t.faint;
    const amountColor = isIncome ? t.success : isRefund || isEx ? t.danger : t.sub;
    const sign = isIncome || (isTr && tx.amount > 0) ? "" : "−";

    return (
      <Pressable
        onPress={() => onTxTap(tx)}
        accessibilityRole="button"
        accessibilityLabel={`${desc}, ${isIncome ? "поступление" : isRefund ? "возврат" : isEx ? "списание" : "перевод"} ${formatEUR(Math.abs(tx.amount))}`}
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

  const listHeader = (
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
              accessibilityRole="button"
              accessibilityLabel="Показать все операции"
              className="ml-auto min-h-11 justify-center px-2 active:opacity-60"
            >
              <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
                Все
              </Text>
            </Pressable>
          ) : null}
        </View>
  );

  const sectionHeader = (section: { title: string; net: number }) => (
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
        {section.net < 0 ? "−" : ""}{formatEUR(Math.abs(section.net))}
      </Text>
    </View>
  );

  if (!scroll) {
    return (
      <View>
        {listHeader}
        {sections.length === 0 ? (
          <EmptyState title="Нет операций за период" />
        ) : (
          sections.map((section) => (
            <View key={section.title}>
              {sectionHeader(section)}
              {section.data.map((tx, i) => (
                <View key={tx.id}>
                  {i > 0 ? (
                    <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                  ) : null}
                  {renderRow(tx)}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    );
  }

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      keyExtractor={(tx) => tx.id}
      ListHeaderComponent={listHeader}
      contentContainerStyle={{ paddingBottom: 96 }}
      renderSectionHeader={({ section }) => sectionHeader(section)}
      renderItem={({ item }) => renderRow(item)}
      ItemSeparatorComponent={() => (
        <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
      )}
      ListEmptyComponent={
        <EmptyState title="Нет операций за период" />
      }
    />
  );
}
