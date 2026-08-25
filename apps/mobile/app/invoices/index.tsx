import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useClients } from "@/features/clients/queries";
import {
  useCreditNoteLinks,
  useInvoicePayments,
  useInvoices,
} from "@/features/invoices/queries";
import { InvoiceStatusBadge } from "@/features/invoices/InvoiceStatusBadge";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  todayYmd,
} from "@/features/invoices/format";
import { LoadingBar } from "@/components/ui/LoadingBar";
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
  // Пришли с карточки клиента — спрашиваем только его счета, а не всю историю
  // компании ради одного экрана.
  const invoices = useInvoices(clientId ? { clientId } : undefined);
  const paymentRows = useInvoicePayments();
  // Кредит-ноты живут в той же таблице: без связки kind сторно печаталось бы
  // как «Инвойс CN-… · Оплачен» с минусовой суммой.
  const creditLinks = useCreditNoteLinks();
  const clientsQuery = useClients();
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const scopedInvoices = useMemo(() => invoices.data ?? [], [invoices.data]);
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
  // Сторно с отрицательным итогом ломает арифметику settlement (клампы дают
  // «оплачен»), поэтому кредит-ноты не участвуют ни в сегментах «К оплате» /
  // «Оплачены», ни в сводке — они видны в «Все» своим честным видом.
  const creditNotes = creditLinks.data?.originalByNoteId;
  const data = useMemo(() => {
    const rows = scopedInvoices;
    if (filter === "open") {
      return rows.filter((invoice) =>
        invoice.status !== "void" &&
        !creditNotes?.has(invoice.id) &&
        (settlements.get(invoice.id)?.remaining ?? 0) > 0,
      );
    }
    if (filter === "paid") {
      return rows.filter((invoice) =>
        !creditNotes?.has(invoice.id) && settlements.get(invoice.id)?.isPaid,
      );
    }
    return rows;
  }, [filter, scopedInvoices, settlements, creditNotes]);

  // Σ просроченного здесь НЕ считается (владелец 2026-08-15: «неоплаченный
  // документ — ничего страшного, не надо выставлять его якобы красным»).
  // Красная ячейка «Просрочено» превращала обычный неоплаченный счёт в
  // тревогу; само слово «Просрочен» осталось в строке инвойса — этого хватает
  // (тот же тон, что в app/documents/index.tsx и панели «Документы»).
  const summary = useMemo(() => {
    let outstanding = 0;
    let paid = 0;
    for (const invoice of scopedInvoices) {
      if (invoice.status === "void") continue;
      if (creditNotes?.has(invoice.id)) continue;
      const settlement = settlements.get(invoice.id);
      if (!settlement) continue;
      outstanding += settlement.remaining;
      paid += settlement.paid;
    }
    return { outstanding, paid };
  }, [scopedInvoices, settlements, creditNotes]);

  const numberById = useMemo(
    () => new Map((invoices.data ?? []).map((invoice) => [invoice.id, invoice.number])),
    [invoices.data],
  );

  const loading =
    invoices.isLoading ||
    paymentRows.isLoading ||
    creditLinks.isLoading ||
    clientsQuery.isLoading ||
    calendarSettingsQuery.isLoading;
  const loadError =
    (invoices.data === undefined ? invoices.error : null) ||
    (paymentRows.data === undefined ? paymentRows.error : null) ||
    (creditLinks.data === undefined ? creditLinks.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined
      ? calendarSettingsQuery.error
      : null);
  // Промис ВОЗВРАЩАЕМ: без него контрол гаснет на тёплом кэше раньше данных.
  const refresh = () =>
    Promise.all([
      invoices.refetch(),
      paymentRows.refetch(),
      creditLinks.refetch(),
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
          action={{ label: "Повторить", onPress: () => void refresh() }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Инвойсы" />

      {clientId ? (
        <View
          className="mx-3 mt-3 flex-row items-center px-4 py-3"
          style={{ borderRadius: t.radius.card, backgroundColor: t.surface }}
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

      <View
        className="mx-3 mt-3 overflow-hidden"
        style={{ borderRadius: t.radius.card, backgroundColor: t.surface }}
      >
        <View className="flex-row px-4 py-3">
          <SummaryCell label="К оплате" value={summary.outstanding} color={t.warning} />
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

      <LoadingBar
        visible={
          (invoices.isRefetching ||
            paymentRows.isRefetching ||
            clientsQuery.isRefetching ||
            calendarSettingsQuery.isRefetching) &&
          !pull.refreshing
        }
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
          const stornoOfId = creditNotes?.get(item.id);
          return (
            <InvoiceRow
              invoice={item}
              settlement={settlements.get(item.id) ?? calculateInvoiceSettlement(item, [])}
              stornoOf={stornoOfId
                ? (numberById.get(stornoOfId) ?? "инвойса")
                : undefined}
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
      <Text
        className="mt-1 text-[16px] font-bold"
        // Только стилем: `tabular-nums` в className в этом стеке — пустышка.
        style={{ color, fontVariant: ["tabular-nums"] }}
        numberOfLines={1}
      >
        {formatInvoiceMoney(value)}
      </Text>
    </View>
  );
}

function InvoiceRow({
  invoice,
  settlement,
  stornoOf,
  clientName,
  clientArchived,
  today,
  onPress,
}: {
  invoice: InvoiceLedger;
  settlement: InvoiceSettlement;
  /** Номер сторнированного инвойса — строка перед нами кредит-нота, и она
   *  зовётся своим именем, а не «Инвойс … Оплачен» с минусом. */
  stornoOf?: string;
  clientName?: string;
  clientArchived: boolean;
  today: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const isCreditNote = stornoOf != null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${isCreditNote ? "Кредит-нота " : ""}${invoice.number}, ${formatInvoiceMoney(invoice.total, invoice.currency)}`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
      style={{ minHeight: 72, backgroundColor: t.surface }}
    >
      <View className="flex-1 pr-3">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="text-base font-semibold" style={{ color: t.ink }} numberOfLines={1}>
            {invoice.number}
          </Text>
          {isCreditNote ? (
            <Badge label="Кредит-нота" variant="neutral" />
          ) : (
            <InvoiceStatusBadge invoice={invoice} settlement={settlement} today={today} />
          )}
        </View>
        <Text className="mt-1 text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
          {[
            isCreditNote ? `Сторно ${stornoOf}` : null,
            clientName ? `${clientName}${clientArchived ? " · Архив" : ""}` : "Без клиента",
            formatInvoiceDate(invoice.issued_on),
          ].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-base font-bold"
          style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
        >
          {formatInvoiceMoney(invoice.total, invoice.currency)}
        </Text>
        {!isCreditNote && settlement.isPartial ? (
          <Text
            className="mt-0.5 text-xs"
            style={{ color: t.warning, fontVariant: ["tabular-nums"] }}
          >
            Остаток {formatInvoiceMoney(settlement.remaining, invoice.currency)}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={18} />
    </Pressable>
  );
}
