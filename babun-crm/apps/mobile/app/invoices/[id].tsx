import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Share2 } from "lucide-react-native";
import {
  calculateInvoicePaymentRefundable,
  calculateInvoiceSettlement,
  INVOICE_STATUS_LABELS,
  invoiceDisplayStatus,
  invoicePaymentRefundDestination,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { ValueRow } from "@/components/ui/ValueRow";
import { ICON } from "@/components/ui/tokens";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  todayYmd,
} from "@/features/invoices/format";
import { InvoicePaymentSheet } from "@/features/invoices/InvoicePaymentSheet";
import { InvoiceRefundSheet } from "@/features/invoices/InvoiceRefundSheet";
import { shareInvoicePdf } from "@/features/invoices/share-pdf";
import { buildInvoiceShareText } from "@/features/invoices/text";
import { InvoiceStatusBadge } from "@/features/invoices/InvoiceStatusBadge";
import {
  useInvoice,
  useInvoicePayments,
  useRecordInvoicePayment,
  useRefundInvoicePayment,
  useSetInvoiceStatus,
} from "@/features/invoices/queries";
import { useTeams } from "@/features/reference/queries";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useThemeColors } from "@/theme/colors";

export default function InvoiceDetailScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);
  const clientsQuery = useClients();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const appointmentsQuery = useAppointments();
  const appointments = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const teamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const accountsQuery = useAccountsWithBalances();
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const tenantQuery = useTenant();
  const tenant = tenantQuery.data;
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const paymentRows = useInvoicePayments();
  const setStatus = useSetInvoiceStatus(id);
  const pay = useRecordInvoicePayment(id);
  const refund = useRefundInvoicePayment(id);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<InvoicePaymentLedger | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");

  const client = useMemo(
    () => clients.find((item) => item.id === invoice.data?.client_id),
    [clients, invoice.data?.client_id],
  );
  const appointment = appointments.find((item) => item.id === invoice.data?.appointment_id);
  const team = teams.find((item) => item.id === invoice.data?.brigade_id);
  const payments = useMemo(
    () => paymentRows.data?.[id] ?? [],
    [id, paymentRows.data],
  );
  const settlement = useMemo(
    () => invoice.data ? calculateInvoiceSettlement(invoice.data, payments) : null,
    [invoice.data, payments],
  );
  const refundAvailable = useMemo(
    () => refundTarget
      ? calculateInvoicePaymentRefundable(refundTarget, payments)
      : 0,
    [payments, refundTarget],
  );
  const paymentAccounts = useMemo(
    () => invoice.data?.brigade_id
      ? accounts.filter(
          (account) =>
            account.is_active &&
            account.brigade_id === invoice.data?.brigade_id,
        )
      : accounts.filter((account) => account.is_active),
    [accounts, invoice.data?.brigade_id],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const shareInvoice = async () => {
    if (!invoice.data) return;
    try {
      await Share.share({
        message: buildInvoiceShareText({
          invoice: invoice.data,
          companyName: tenant?.legal_name || tenant?.name,
          clientName: client?.full_name,
          settlement: settlement ?? undefined,
        }),
      });
    } catch (error) {
      Alert.alert("Не удалось поделиться", (error as Error).message);
    }
  };

  const sharePdf = async () => {
    if (!invoice.data || !settlement) return;
    if (!tenant && !invoice.data.seller_snapshot) {
      Alert.alert(
        "PDF пока недоступен",
        "Реквизиты компании ещё загружаются. Попробуйте через несколько секунд.",
      );
      return;
    }
    setPdfBusy(true);
    try {
      await shareInvoicePdf({
        invoice: invoice.data,
        tenant: tenant ?? undefined,
        client,
        settlement,
        payments,
        accountNames: accountById,
        businessToday,
      });
    } catch (error) {
      Alert.alert("Не удалось поделиться PDF", (error as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  const voidInvoice = () =>
    Alert.alert(
      "Аннулировать инвойс?",
      "Документ останется в истории, но перестанет учитываться как ожидающий оплату.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Аннулировать",
          style: "destructive",
          onPress: () =>
            setStatus.mutate("void", {
              onError: (error) => Alert.alert("Ошибка", error.message),
            }),
        },
      ],
    );

  const loading =
    invoice.isLoading ||
    paymentRows.isLoading ||
    clientsQuery.isLoading ||
    appointmentsQuery.isLoading ||
    teamsQuery.isLoading ||
    accountsQuery.isLoading ||
    tenantQuery.isLoading ||
    calendarSettingsQuery.isLoading;
  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Инвойс" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  const loadError =
    (invoice.data === undefined ? invoice.error : null) ||
    (paymentRows.data === undefined ? paymentRows.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (tenantQuery.data === undefined ? tenantQuery.error : null) ||
    (calendarSettingsQuery.data === undefined
      ? calendarSettingsQuery.error
      : null);
  if (loadError || !invoice.data || !settlement) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Инвойс" />
        <EmptyState
          state="error"
          fill
          title={invoice.data === null ? "Инвойс не найден" : undefined}
          subtitle={(loadError as Error | null)?.message}
          action={{
            label: "Повторить",
            onPress: () => void Promise.all([
              invoice.refetch(),
              paymentRows.refetch(),
              clientsQuery.refetch(),
              appointmentsQuery.refetch(),
              teamsQuery.refetch(),
              accountsQuery.refetch(),
              tenantQuery.refetch(),
              calendarSettingsQuery.refetch(),
            ]),
          }}
        />
      </Screen>
    );
  }

  const row = invoice.data;
  const recipientName = row.client_snapshot
    ? row.client_snapshot.full_name
    : client?.full_name;
  const clientIsArchived = client
    ? client.deleted_at != null
    : row.client_snapshot?.archived === true
      || (clientsQuery.isSuccess && !!row.client_id);
  const status = invoiceDisplayStatus(row, businessToday, settlement);
  const isOverdue =
    row.status !== "void" &&
    settlement.remaining > 0 &&
    !!row.due_on &&
    row.due_on < businessToday;

  const openPayment = () => {
    if (paymentAccounts.length > 0) {
      setPaymentOpen(true);
      return;
    }
    Alert.alert(
      "Нет активного финансового счёта",
      row.brigade_id
        ? "Создайте или активируйте счёт для этой команды, затем отметьте инвойс оплаченным."
        : "Создайте или активируйте финансовый счёт, затем отметьте инвойс оплаченным.",
      [
        { text: "Отмена", style: "cancel" },
        { text: "Открыть счета", onPress: () => router.push("/accounts") },
      ],
    );
  };

  const openLinkedAppointment = () => {
    if (!appointment) return;
    router.push({
      pathname: "/",
      params: {
        appointmentId: appointment.id,
        date: appointment.date,
        teamId: appointment.team_id ?? undefined,
      },
    } as unknown as Href);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={row.number}
        right={
          <Pressable
            onPress={pdfBusy ? undefined : sharePdf}
            disabled={pdfBusy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Поделиться PDF"
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <Share2 color={t.body} size={ICON.sm} />
          </Pressable>
        }
      />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="items-center px-4 pb-4 pt-5">
          <InvoiceStatusBadge invoice={row} settlement={settlement} today={businessToday} />
          <Text className="mt-3 text-[38px] font-bold tabular-nums" style={{ color: t.ink }}>
            {formatInvoiceMoney(row.total, row.currency)}
          </Text>
          <Text className="mt-1 text-sm" style={{ color: isOverdue ? t.danger : t.sub }}>
            {isOverdue
              ? `Оплата просрочена · до ${formatInvoiceDate(row.due_on)}`
              : INVOICE_STATUS_LABELS[status]}
          </Text>
          <Text className="mt-2 text-sm tabular-nums" style={{ color: t.body }}>
            Оплачено {formatInvoiceMoney(settlement.paid, row.currency)} · остаток{" "}
            {formatInvoiceMoney(settlement.remaining, row.currency)}
          </Text>
        </View>

        <SectionCard title="Документ">
          <InfoRow label="Выставлен" value={formatInvoiceDate(row.issued_on)} />
          <Divider inset={16} />
          <InfoRow label="Оплатить до" value={formatInvoiceDate(row.due_on)} />
          <Divider inset={16} />
          <InfoRow label="Валюта" value={row.currency} />
        </SectionCard>

        <SectionCard title="Получатель">
          {recipientName && client && !clientIsArchived ? (
            <ValueRow
              label="Клиент"
              value={recipientName}
              onPress={() => router.push(`/clients/${client.id}`)}
            />
          ) : recipientName ? (
            <InfoRow
              label="Клиент"
              value={clientIsArchived ? `${recipientName} · Архив` : recipientName}
              muted={clientIsArchived}
            />
          ) : (
            <InfoRow label="Клиент" value="Не привязан" muted />
          )}
          <Divider inset={16} />
          {appointment ? (
            <ValueRow
              label="Заявка"
              value={`${formatInvoiceDate(appointment.date)} · ${appointment.time_start}`}
              onPress={openLinkedAppointment}
            />
          ) : (
            <InfoRow label="Заявка" value="Не привязана" muted />
          )}
          <Divider inset={16} />
          <InfoRow label="Команда" value={team?.name ?? "Не выбрана"} muted={!team} />
        </SectionCard>

        <SectionCard title="Позиции">
          {row.lines.map((line, index) => (
            <View key={line.id}>
              {index ? <Divider inset={16} /> : null}
              <View className="flex-row px-4 py-3">
                <View className="flex-1 pr-3">
                  <Text className="text-base font-medium" style={{ color: t.ink }}>{line.title}</Text>
                  <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
                    {line.qty} × {formatInvoiceMoney(line.unit_price, row.currency)}
                  </Text>
                </View>
                <Text className="text-base font-semibold tabular-nums" style={{ color: t.ink }}>
                  {formatInvoiceMoney(line.total, row.currency)}
                </Text>
              </View>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Итого">
          <InfoRow label="Без VAT" value={formatInvoiceMoney(row.subtotal_net, row.currency)} />
          {row.vat_amount > 0 ? (
            <>
              <Divider inset={16} />
              <InfoRow label={`VAT ${row.vat_percent}%`} value={formatInvoiceMoney(row.vat_amount, row.currency)} />
            </>
          ) : null}
          <Divider inset={16} />
          <InfoRow label="К оплате" value={formatInvoiceMoney(row.total, row.currency)} strong />
        </SectionCard>

        <SectionCard title="Оплата">
          <InfoRow
            label="Оплачено"
            value={formatInvoiceMoney(settlement.paid, row.currency)}
          />
          <Divider inset={16} />
          <InfoRow
            label="Остаток"
            value={formatInvoiceMoney(settlement.remaining, row.currency)}
            strong
          />
          {payments.length > 0 ? (
            payments.map((payment) => {
              const refundable = calculateInvoicePaymentRefundable(payment, payments);
              const refundDestination = invoicePaymentRefundDestination(payment, payments);
              const refundInAppointment = refundDestination === "appointment";
              return (
                <View key={payment.id}>
                  <Divider inset={16} />
                  <PaymentHistoryRow
                    payment={payment}
                    accountName={payment.account_id ? accountById.get(payment.account_id) : undefined}
                    currency={row.currency}
                    refundable={refundable}
                    refundInAppointment={refundInAppointment}
                    appointmentLookupComplete={appointmentsQuery.isFetched}
                    onOpenAppointment={refundInAppointment && appointment
                      ? openLinkedAppointment
                      : undefined}
                    onRefund={
                      refundDestination === "invoice"
                        ? () => setRefundTarget(payment)
                        : undefined
                    }
                  />
                </View>
              );
            })
          ) : row.status === "paid" ? (
            <>
              <Divider inset={16} />
              <Text className="px-4 py-3 text-sm leading-5" style={{ color: t.sub }}>
                Оплата отмечена ранее; детальной операции в журнале нет.
              </Text>
            </>
          ) : (
            <>
              <Divider inset={16} />
              <Text className="px-4 py-3 text-sm" style={{ color: t.sub }}>
                Платежей пока нет.
              </Text>
            </>
          )}
        </SectionCard>

        {row.notes ? (
          <SectionCard title="Комментарий" padded>
            <Text className="text-[15px] leading-5" style={{ color: t.body }}>{row.notes}</Text>
          </SectionCard>
        ) : null}

        <View className="mx-4 mt-5" style={{ gap: 9 }}>
          {row.status !== "void" && settlement.remaining > 0 ? (
            <Button
              label={settlement.paid > 0 ? "Добавить платёж" : "Принять оплату"}
              onPress={openPayment}
            />
          ) : null}
          {row.status === "issued" && settlement.paid === 0 ? (
            <>
              {payments.length === 0 ? (
                <Button
                  label="Редактировать"
                  variant="secondary"
                  onPress={() => router.push(`/invoices/edit/${row.id}` as Href)}
                />
              ) : null}
              <Button label="Аннулировать инвойс" variant="secondary" tone="danger" onPress={voidInvoice} />
            </>
          ) : null}
          <Button
            label="Поделиться PDF"
            variant="secondary"
            onPress={sharePdf}
            loading={pdfBusy}
            disabled={(!tenant && !row.seller_snapshot) || pdfBusy}
          />
          <Button label="Поделиться текстом" variant="secondary" onPress={shareInvoice} />
        </View>
      </ScrollView>

      <InvoicePaymentSheet
        visible={paymentOpen}
        total={row.total}
        paid={settlement.paid}
        remaining={settlement.remaining}
        currency={row.currency}
        businessToday={businessToday}
        brigadeId={row.brigade_id}
        accounts={paymentAccounts}
        submitting={pay.isPending}
        onSubmit={async (value) => {
          await pay.mutateAsync(value);
        }}
        onClose={() => setPaymentOpen(false)}
      />
      <InvoiceRefundSheet
        visible={refundTarget != null}
        payment={refundTarget}
        refundable={refundAvailable}
        currency={row.currency}
        businessToday={businessToday}
        accountName={refundTarget?.account_id
          ? accountById.get(refundTarget.account_id)
          : undefined}
        submitting={refund.isPending}
        onSubmit={async (value) => {
          await refund.mutateAsync(value);
        }}
        onClose={() => setRefundTarget(null)}
      />
    </Screen>
  );
}

function InfoRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-4 py-3" style={{ minHeight: 48 }}>
      <Text className="text-base" style={{ color: t.ink }}>{label}</Text>
      <Text
        className={strong ? "ml-3 text-lg font-bold tabular-nums" : "ml-3 flex-1 text-right text-base"}
        style={{ color: muted ? t.faint : t.ink }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
};

function PaymentHistoryRow({
  payment,
  accountName,
  currency,
  refundable,
  refundInAppointment,
  appointmentLookupComplete,
  onOpenAppointment,
  onRefund,
}: {
  payment: InvoicePaymentLedger;
  accountName?: string;
  currency: string;
  refundable: number;
  refundInAppointment: boolean;
  appointmentLookupComplete: boolean;
  onOpenAppointment?: () => void;
  onRefund?: () => void;
}) {
  const t = useThemeColors();
  const isRefund = payment.type === "refund";
  const meta = [
    formatInvoiceDate(payment.occurred_on),
    accountName || "Счёт не указан",
    payment.payment_method
      ? PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method
      : null,
    payment.type === "income" && refundable <= 0 ? "возвращён полностью" : null,
    refundInAppointment
      ? onOpenAppointment
        ? "возврат оформляется в заявке"
        : appointmentLookupComplete
          ? "связанная заявка недоступна — возврат здесь заблокирован"
          : "загрузка связанной заявки"
      : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <View className="flex-row items-center px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="text-[15px] font-medium" style={{ color: t.ink }}>
          {isRefund ? "Возврат" : "Платёж"}
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: t.sub }} numberOfLines={2}>
          {meta.join(" · ")}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-base font-semibold tabular-nums"
          style={{ color: isRefund ? t.danger : t.success }}
        >
          {isRefund ? "−" : ""}{formatInvoiceMoney(Math.abs(payment.amount), currency)}
        </Text>
        {onOpenAppointment ? (
          <Pressable
            onPress={onOpenAppointment}
            accessibilityRole="button"
            accessibilityLabel="Открыть заявку для возврата оплаты"
            className="mt-1 min-h-11 justify-center rounded-full px-3 active:opacity-60"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.accent }}>
              Открыть заявку
            </Text>
          </Pressable>
        ) : onRefund ? (
          <Pressable
            onPress={onRefund}
            accessibilityRole="button"
            accessibilityLabel={`Оформить возврат по платежу ${formatInvoiceMoney(Math.abs(payment.amount), currency)}`}
            className="mt-1 min-h-11 justify-center rounded-full px-3 active:opacity-60"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.danger }}>
              Вернуть
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
