import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useClients } from "@/features/clients/queries";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { InvoiceStatusBadge } from "@/features/invoices/InvoiceStatusBadge";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  todayYmd,
} from "@/features/invoices/format";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";

type InvoiceFilter = "all" | "open" | "paid";

const FILTERS = [
  { value: "all", label: "Все" },
  { value: "open", label: "К оплате" },
  { value: "paid", label: "Оплачены" },
] as const;

export default function InvoicesScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const invoices = useInvoices();
  const paymentRows = useInvoicePayments();
  const clientsQuery = useClients();
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const scopedInvoices = useMemo(
    () => (invoices.data ?? []).filter(
      (invoice) => !clientId || invoice.client_id === clientId,
    ),
    [clientId, invoices.data],
  );
  const activeClient = clientId ? clientById.get(clientId) : undefined;
  const activeClientSnapshot = clientId
    ? scopedInvoices.find((invoice) => invoice.client_snapshot != null)
      ?.client_snapshot
    : undefined;
  const settlements = useMemo(
    () => new Map(
      (invoices.data ?? []).map((invoice) => [
        invoice.id,
        calculateInvoiceSettlement(invoice, paymentRows.data?.[invoice.id] ?? []),
      ]),
    ),
    [invoices.data, paymentRows.data],
  );
  const data = useMemo(() => {
    const rows = scopedInvoices;
    if (filter === "open") {
      return rows.filter((invoice) =>
        invoice.status !== "void" && (settlements.get(invoice.id)?.remaining ?? 0) > 0,
      );
    }
    if (filter === "paid") {
      return rows.filter((invoice) => settlements.get(invoice.id)?.isPaid);
    }
    return rows;
  }, [filter, scopedInvoices, settlements]);

  const summary = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    let paid = 0;
    for (const invoice of scopedInvoices) {
      if (invoice.status === "void") continue;
      const settlement = settlements.get(invoice.id);
      if (!settlement) continue;
      outstanding += settlement.remaining;
      paid += settlement.paid;
      if (
        settlement.remaining > 0 &&
        invoice.due_on &&
        invoice.due_on < businessToday
      ) {
        overdue += settlement.remaining;
      }
    }
    return { outstanding, overdue, paid };
  }, [businessToday, scopedInvoices, settlements]);

  const loading =
    invoices.isLoading ||
    paymentRows.isLoading ||
    clientsQuery.isLoading ||
    calendarSettingsQuery.isLoading;
  const loadError =
    (invoices.data === undefined ? invoices.error : null) ||
    (paymentRows.data === undefined ? paymentRows.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined
      ? calendarSettingsQuery.error
      : null);
  // Промис ВОЗВРАЩАЕМ: без него контрол гаснет на тёплом кэше раньше данных.
  const refresh = () =>
    Promise.all([
      invoices.refetch(),
      paymentRows.refetch(),
      clientsQuery.refetch(),
      calendarSettingsQuery.refetch(),
    ]);
  const pull = usePullRefresh(refresh);

  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Инвойсы" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Инвойсы" />
        <EmptyState
          state="error"
          fill
          subtitle={(loadError as Error).message}
          action={{ label: "Повторить", onPress: refresh }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Инвойсы" />

      {clientId ? (
        <View
          className="mx-3 mt-3 flex-row items-center rounded-xl px-4 py-3"
          style={{ backgroundColor: t.surface }}
        >
          <View className="flex-1 pr-3">
            <Text className="text-xs font-semibold uppercase" style={{ color: t.faint }}>
              Инвойсы клиента
            </Text>
            <Text className="mt-0.5 text-base font-semibold" style={{ color: t.ink }} numberOfLines={1}>
              {activeClientSnapshot
                ? activeClientSnapshot.full_name ?? "Получатель не указан"
                : activeClient?.full_name ?? "Клиент не найден"}
              {!activeClient && activeClientSnapshot && clientsQuery.isSuccess ? " · Архив" : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => router.replace("/invoices" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Показать инвойсы всех клиентов"
            hitSlop={8}
            className="rounded-full px-3 py-2 active:opacity-60"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.accent }}>
              Все клиенты
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mx-3 mt-3 overflow-hidden rounded-2xl" style={{ backgroundColor: t.surface }}>
        <View className="flex-row px-4 py-3">
          <SummaryCell label="К оплате" value={summary.outstanding} color={t.warning} />
          <View className="w-px" style={{ backgroundColor: t.separator }} />
          <SummaryCell label="Просрочено" value={summary.overdue} color={t.danger} />
          <View className="w-px" style={{ backgroundColor: t.separator }} />
          <SummaryCell label="Оплачено" value={summary.paid} color={t.success} />
        </View>
      </View>

      <SegmentedControl
        options={FILTERS}
        value={filter}
        onChange={setFilter}
        style={{ marginHorizontal: 12, marginTop: 12, marginBottom: 6 }}
      />

      <FlatList
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(invoice) => invoice.id}
        refreshControl={
          // Контрол = ЖЕСТ. Раньше он питался от isRefetching четырёх
          // запросов, то есть срабатывал сам при каждом возврате на экран.
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
        ItemSeparatorComponent={() => <View className="h-px" style={{ backgroundColor: t.separator }} />}
        ListEmptyComponent={
          <EmptyState
            icon={<FileText color={t.faint} size={34} />}
            title={filter === "all" ? "Инвойсов пока нет" : "В этой группе пусто"}
            subtitle={filter === "all" ? "Создайте первый инвойс и привяжите его к клиенту или заявке." : undefined}
          />
        }
        renderItem={({ item }) => {
          const liveClient = item.client_id ? clientById.get(item.client_id) : undefined;
          return (
            <InvoiceRow
              invoice={item}
              settlement={settlements.get(item.id) ?? calculateInvoiceSettlement(item, [])}
              clientName={item.client_snapshot
                ? item.client_snapshot.full_name ?? undefined
                : liveClient?.full_name}
              clientArchived={
                liveClient
                  ? liveClient.deleted_at != null
                  : item.client_snapshot?.archived === true
                    || (clientsQuery.isSuccess && !!item.client_id)
              }
              today={businessToday}
              onPress={() => router.push(`/invoices/${item.id}` as Href)}
            />
          );
        }}
      />

      <View className="px-4 pb-3 pt-2" style={{ backgroundColor: t.canvas }}>
        <Button
          label="Новый инвойс"
          onPress={() => router.push({
            pathname: "/invoices/new",
            params: clientId ? { clientId } : {},
          } as unknown as Href)}
        />
      </View>
    </Screen>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: number; color: string }) {
  const t = useThemeColors();
  return (
    <View className="flex-1 items-center px-1">
      <Text className="text-[11px] font-semibold uppercase" style={{ color: t.faint }} numberOfLines={1}>
        {label}
      </Text>
      <Text className="mt-1 text-[16px] font-bold tabular-nums" style={{ color }} numberOfLines={1}>
        {formatInvoiceMoney(value)}
      </Text>
    </View>
  );
}

function InvoiceRow({
  invoice,
  settlement,
  clientName,
  clientArchived,
  today,
  onPress,
}: {
  invoice: InvoiceLedger;
  settlement: InvoiceSettlement;
  clientName?: string;
  clientArchived: boolean;
  today: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${invoice.number}, ${formatInvoiceMoney(invoice.total, invoice.currency)}`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
      style={{ minHeight: 72, backgroundColor: t.surface }}
    >
      <View className="flex-1 pr-3">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="text-base font-semibold" style={{ color: t.ink }} numberOfLines={1}>
            {invoice.number}
          </Text>
          <InvoiceStatusBadge invoice={invoice} settlement={settlement} today={today} />
        </View>
        <Text className="mt-1 text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
          {[
            clientName ? `${clientName}${clientArchived ? " · Архив" : ""}` : "Без клиента",
            formatInvoiceDate(invoice.issued_on),
          ].join(" · ")}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-base font-bold tabular-nums" style={{ color: t.ink }}>
          {formatInvoiceMoney(invoice.total, invoice.currency)}
        </Text>
        {settlement.isPartial ? (
          <Text className="mt-0.5 text-xs tabular-nums" style={{ color: t.warning }}>
            Остаток {formatInvoiceMoney(settlement.remaining, invoice.currency)}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={18} />
    </Pressable>
  );
}
