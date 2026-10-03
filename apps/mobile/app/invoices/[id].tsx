import { useMemo, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { MoreHorizontal, Share2 } from "lucide-react-native";
import {
  calculateInvoicePaymentRefundable,
  calculateInvoiceSettlement,
  INVOICE_STATUS_LABELS,
  invoiceDisplayStatus,
  invoicePaymentRefundDestination,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import { Badge } from "@/components/ui/Badge";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import { ValueRow } from "@/components/ui/ValueRow";
import { ICON } from "@/components/ui/tokens";
import { chooseOption } from "@/lib/choose";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  todayYmd,
} from "@/features/invoices/format";
import { InvoicePaymentSheet } from "@/features/invoices/InvoicePaymentSheet";
import { InvoiceRefundSheet } from "@/features/invoices/InvoiceRefundSheet";
import { shareInvoicePdf } from "@/features/invoices/share-pdf";
import { buildInvoiceDocument } from "@/features/invoices/document";
import { buildInvoiceShareText } from "@/features/invoices/text";
import { InvoiceStatusBadge } from "@/features/invoices/InvoiceStatusBadge";
import { InvoicePaper } from "@/features/invoices/InvoicePaper";
import {
  useCancelInvoice,
  useCreditNoteLinks,
  useInvoice,
  useInvoicePayments,
  useInvoices,
  useRecordInvoicePayment,
  useRefundInvoicePayment,
  useSetInvoiceLanguage,
} from "@/features/invoices/queries";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useIssueReceipt, useReceipts } from "@/features/documents/receipts-queries";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

export default function InvoiceDetailScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);
  const clientsQuery = useClients();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const appointmentsQuery = useAppointments();
  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data]);
  const accountsQuery = useAccountsWithBalances();
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const tenantQuery = useTenant();
  const tenant = tenantQuery.data;
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const paymentRows = useInvoicePayments();
  // Связи кредит-нот: без них сторно выглядело бы «Инвойс CN-… · Оплачен».
  const creditLinks = useCreditNoteLinks();
  // Список инвойсов — только чтобы назвать связанный документ его номером;
  // страницу он не гейтит (обычно уже в кэше после списка).
  const invoicesQuery = useInvoices();
  const numberById = useMemo(
    () => new Map((invoicesQuery.data ?? []).map((item) => [item.id, item.number])),
    [invoicesQuery.data],
  );
  // Кредит-нота печатается кредит-нотой со ссылкой на отменённый инвойс —
  // на странице, в PDF и в тексте одинаково (аудит 03.10).
  const creditNoteOfId = creditLinks.data?.originalByNoteId.get(id) ?? null;
  const creditNote = creditNoteOfId
    ? { originalNumber: numberById.get(creditNoteOfId) ?? null }
    : null;
  const pay = useRecordInvoicePayment(id);
  const refund = useRefundInvoicePayment(id);
  const cancel = useCancelInvoice(id);
  const setLanguage = useSetInvoiceLanguage(id);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<InvoicePaymentLedger | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  // ЧЕК — ТОЛЬКО У ИНВОЙСА (владелец 2026-09-30: «отдельно чеки пока что не
  // делай; чек можно выставить на выставленный инвойс — на оплату, принятую
  // по нему»). Инвойс оплачен — внизу «Выписать чек», выписанный чек стоит
  // блоком на странице и открывается листом.
  const receiptsQuery = useReceipts({ invoiceId: id, enabled: !!id });
  const issueReceipt = useIssueReceipt();
  const toast = useToast();
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const [issuing, setIssuing] = useState(false);
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");

  const client = useMemo(
    () => clients.find((item) => item.id === invoice.data?.client_id),
    [clients, invoice.data?.client_id],
  );
  const appointment = appointments.find((item) => item.id === invoice.data?.appointment_id);
  const payments = useMemo(() => paymentRows.data?.[id] ?? [], [id, paymentRows.data]);
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
  // ДОКУМЕНТ БЕЗ КЛИЕНТА МОЖНО ПРИВЯЗАТЬ (владелец 2026-09-07: «открываю
  // документ — сверху пишет, что он ни к чему не присвоен, и предлагает
  // выбрать клиента, чтобы не потерялся»). Идёт тем же путём, что правка
  // инвойса: сервер пересобирает снимок клиента и печатает его на бумаге.
  // Счёт компании обслуживает подключённые к нему команды — сервер такую
  // оплату принимает, а экран её запрещал: инвойс команды нельзя было
  // оплатить на общий Revolut, хотя деньги приходят именно туда.
  const paymentAccounts = useMemo(
    () => accountsForTeam(accounts, invoice.data?.brigade_id ?? null),
    [accounts, invoice.data?.brigade_id],
  );
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const receipts = useMemo(() => receiptsQuery.data ?? [], [receiptsQuery.data]);
  // Платежи, по которым чек ещё не выписан. Возвращённый целиком чека не
  // получает — сервер откажет («оформлен полный возврат»).
  const paymentsWithoutReceipt = useMemo(() => {
    const withReceipt = new Set(receipts.map((r) => r.transaction_id));
    return payments.filter(
      (p) =>
        p.type === "income" &&
        !withReceipt.has(p.id) &&
        calculateInvoicePaymentRefundable(p, payments) > 0,
    );
  }, [payments, receipts]);

  const issueReceipts = async () => {
    if (issuing) return;
    setIssuing(true);
    try {
      // Чек — на каждый платёж без чека: обычно он один, при доплатах —
      // по одному на каждую.
      for (const payment of paymentsWithoutReceipt) {
        const receipt = await issueReceipt.mutateAsync({ transactionId: payment.id });
        haptics.success();
        toast(`Чек ${receipt.number} выписан`);
      }
    } catch (error) {
      notify("Чек не выписан", error instanceof Error ? error.message : undefined);
    } finally {
      setIssuing(false);
    }
  };

  const shareInvoice = async () => {
    // Итоги — часть документа, а не украшение: без них сообщение не собрать,
    // и лучше промолчать, чем отправить клиенту счёт без сумм.
    if (!invoice.data || !settlement) return;
    try {
      await Share.share({
        // ТЕКСТ И PDF — ОДНА МОДЕЛЬ. Раньше сообщение считало состав само и
        // расходилось с вложением словами за одну отправку.
        message: buildInvoiceShareText(
          buildInvoiceDocument({
            invoice: invoice.data,
            tenant: tenant ?? undefined,
            client,
            settlement,
            payments,
            accountNames: accountById,
            businessToday,
            language: invoice.data.language as "ru" | "en" | undefined,
            creditNote,
          }),
        ),
      });
    } catch (error) {
      notify("Не удалось поделиться", (error as Error).message);
    }
  };

  const sharePdf = async () => {
    if (!invoice.data || !settlement) return;
    if (!tenant && !invoice.data.seller_snapshot) {
      notify(
        "PDF пока недоступен",
        "Реквизиты компании ещё загружаются. Попробуйте через несколько секунд.",
      );
      return;
    }
    setPdfBusy(true);
    try {
      await shareInvoicePdf({
        // ЯЗЫК ДОКУМЕНТА ЕДЕТ ВМЕСТЕ С НИМ. Он выбран при выставлении и лежит
        // в строке инвойса; без него PDF уходил клиенту всегда по-русски,
        // даже собранный на английском (аудит бумаги 2026-09-20).
        language: invoice.data.language as "ru" | "en" | undefined,
        invoice: invoice.data,
        tenant: tenant ?? undefined,
        client,
        settlement,
        payments,
        accountNames: accountById,
        businessToday,
        creditNote,
      });
    } catch (error) {
      notify("Не удалось поделиться PDF", (error as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  const runCreditNote = () =>
    cancel.mutate(undefined, {
      onSuccess: (note) => {
        haptics.success();
        // Показываем рождённую кредит-ноту — она и есть результат.
        router.push(`/invoices/${note.id}` as Href);
      },
      onError: (error) => notify("Инвойс не отменён", error.message),
    });

  // ОТКАЗ ОТ ИНВОЙСА — ОДНА ДВЕРЬ И ОДИН ПУТЬ.
  //
  // Владелец 2026-09-12 оставил одну красную кнопку, а выбор «кредит-нота или
  // аннулирование» — в подтверждении. С 2026-10-01 (STORY-101, закон о VAT
  // Кипра) выпущенный документ отменяется ТОЛЬКО кредит-нотой: номер инвойса
  // уже в серии, и тихое «аннулировано» оставило бы в ней документ без
  // встречной бумаги. Сервер «void» без кредит-ноты больше не принимает, и
  // экран его не предлагает.
  const cancelInvoice = async () => {
    // Кнопка живёт только под загруженным документом; guard — на случай
    // вызова не с неё (ротор VoiceOver).
    if (!settlement) return;
    if (settlement.paid > 0) {
      // ДЕНЬГИ ВПЕРЁД БУМАГИ. Сервер отменяет инвойс только когда у нас по нему
      // ничего не осталось (`cancel_invoice` считает доходы минус возвраты), и
      // кредит-нота на инвойс с деньгами не выписывается вовсе. Раньше экран
      // всё равно предлагал отмену и печатал отказ сервера ПОСЛЕ
      // подтверждения — теперь он сразу называет единственный путь.
      notify(
        "Сначала верните оплату",
        `По инвойсу получено ${formatInvoiceMoney(settlement.paid, invoice.data?.currency)}.`
          + " Оформите возврат в списке платежей — после него инвойс отменяется"
          + " кредит-нотой.",
      );
      return;
    }
    const index = await chooseOption(
      "Отменить инвойс?",
      // Одна кнопка рядом с «Отмена» — слово короткое, иначе обрезается.
      [{ label: "Кредит-нота", destructive: true }],
      {
        message:
          "Кредит-нота — встречный документ на ту же сумму: у клиента остаются"
          + " оба, и отказ виден в истории.",
      },
    );
    if (index === 0) runCreditNote();
  };

  const loading =
    invoice.isLoading ||
    paymentRows.isLoading ||
    creditLinks.isLoading ||
    clientsQuery.isLoading ||
    appointmentsQuery.isLoading ||
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
    (creditLinks.data === undefined ? creditLinks.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
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
              creditLinks.refetch(),
              clientsQuery.refetch(),
              appointmentsQuery.refetch(),
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
  // Кредит-нота — не инвойс: не оплачивается, не редактируется и не
  // отменяется, а честно называет себя и ссылается на сторнированный документ.
  const stornoOfId = creditLinks.data?.originalByNoteId.get(row.id) ?? null;
  const isCreditNote = stornoOfId != null;
  const creditNoteId = creditLinks.data?.noteByInvoiceId.get(row.id) ?? null;
  const recipientName = row.client_snapshot
    ? row.client_snapshot.full_name
    : client?.full_name;
  const clientIsArchived = client
    ? client.deleted_at != null
    : row.client_snapshot?.archived === true
      || (clientsQuery.isSuccess && !!row.client_id);
  const status = invoiceDisplayStatus(row, businessToday, settlement);
  // Отменённый (сторнированный) инвойс и кредит-нота денег не ждут.
  const awaitsPayment =
    row.status !== "void" &&
    row.status !== "cancelled" &&
    !isCreditNote &&
    settlement.remaining > 0;
  const isOverdue =
    awaitsPayment &&
    !!row.due_on &&
    row.due_on < businessToday;
  const unassigned = !row.client_id && !isCreditNote;
  const openPayment = () => {
    if (paymentAccounts.length > 0) {
      setPaymentOpen(true);
      return;
    }
    // Счёт одной команды (владелец 2026-08-15) заводится ПРЯМО ЗДЕСЬ, листом
    // (владелец 2026-09-15: «добавлять счёт, не переходя на отдельную
    // страницу»). Уход на «Финансы» из корневого стека клал поверх инвойса
    // вторую копию всех вкладок (`navigate` в expo-router 6 — это push), а
    // человек терял инвойс, который собирался отметить оплаченным.
    confirmThen("Нет активного финансового счёта", {
      message: row.brigade_id
        ? "Заведите счёт этой команде, затем отметьте инвойс оплаченным."
        : "Создайте или активируйте финансовый счёт, затем отметьте инвойс оплаченным.",
      confirmLabel: "Добавить счёт",
      // Шторка счёта — после отъезда вопроса: открытая в миг ответа, она не
      // появлялась, а флаг «открыта» оставался (ревью 2026-09-15).
    }, () => {
      setTimeout(() => setAccountCreateOpen(true), SHEET_EXIT_MS + 350);
    });
  };

  const openLinkedAppointment = () => {
    if (!appointment) return;
    router.push({
      pathname: "/",
      params: {
        appointmentId: appointment.id,
        date: appointment.date,
        teamId: appointment.team_id ?? undefined,
        // Вкладки таб-бара — НЕ стек: без from= закрытие записи бросало бы
        // человека в календарь. Дорогу назад по этому ключу открывает словарь
        // from= календаря (app/(dashboard)/index.tsx).
        from: `invoice:${row.id}`,
      },
    } as unknown as Href);
  };

  // БУМАГА — ТА ЖЕ, ЧТО УХОДИТ PDF (владелец 2026-09-22: «почему не
  // открывается полноценный PDF, который я выставил… внизу — принять
  // оплату»). Страница — это сам документ: статус строкой над ним, бумага,
  // под ней только то, чего на бумаге нет (связи и платежи с возвратом).
  const paperDoc = buildInvoiceDocument({
    invoice: row,
    tenant: tenant ?? undefined,
    client,
    settlement,
    payments,
    accountNames: accountById,
    businessToday,
    language: row.language as "ru" | "en" | undefined,
    creditNote,
  });
  const canCancel = !isCreditNote && row.status === "issued";
  // ЯЗЫК БУМАГИ — ПУНКТОМ МЕНЮ (аудит 03.10): переключателя на документе не
  // было, хотя выставление обещало «переключается одним тапом», и счёт с
  // несохранившимся английским уходил клиенту русским.
  const paperEnglish = row.language === "en";
  const switchLanguage = () =>
    setLanguage.mutate(paperEnglish ? "ru" : "en", {
      onSuccess: () => haptics.success(),
      onError: (error) => notify("Язык не сменился", error.message),
    });
  const openMenu = async () => {
    const actions = [
      { label: "Поделиться PDF", run: () => void sharePdf() },
      { label: "Поделиться текстом", run: () => void shareInvoice() },
      {
        label: paperEnglish ? "Бумага на русском" : "Бумага на английском",
        run: switchLanguage,
      },
      ...(canCancel
        ? [{ label: "Отменить инвойс", destructive: true, run: () => void cancelInvoice() }]
        : []),
    ];
    const index = await chooseOption(
      row.number,
      actions.map(({ label, destructive }) => ({ label, destructive })),
    );
    if (index !== null && index >= 0) actions[index]?.run();
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={row.number}
        right={
          <View style={{ flexDirection: "row" }}>
            <Pressable
              onPress={pdfBusy ? undefined : sharePdf}
              disabled={pdfBusy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Поделиться PDF"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              {/* Сборка PDF занимает секунды: немая иконка под пальцем
                  читается как поломка — на время работы крутится спиннер. */}
              {pdfBusy ? (
                <Spinner size={18} label="Готовим PDF" />
              ) : (
                <Share2 color={t.body} size={ICON.sm} />
              )}
            </Pressable>
            <Pressable
              onPress={() => void openMenu()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Ещё действия"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <MoreHorizontal color={t.body} size={ICON.sm} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
      >
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 4 }}>
        {/* Статус — одной строкой над бумагой: на самой бумаге его нет. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isCreditNote ? (
            <Badge label="Кредит-нота" variant="neutral" />
          ) : (
            <InvoiceStatusBadge invoice={row} settlement={settlement} today={businessToday} />
          )}
          {isCreditNote ? null : (
            <Text
              className="text-sm"
              style={{ color: isOverdue ? t.danger : t.sub, fontVariant: ["tabular-nums"] }}
            >
              {isOverdue
                ? `Просрочен · остаток ${formatInvoiceMoney(settlement.remaining, row.currency)}`
                : settlement.paid > 0
                  ? `Оплачено ${formatInvoiceMoney(settlement.paid, row.currency)} · остаток ${formatInvoiceMoney(settlement.remaining, row.currency)}`
                  : awaitsPayment
                    ? `Ждёт оплату · ${formatInvoiceMoney(settlement.remaining, row.currency)}`
                    : INVOICE_STATUS_LABELS[status]}
            </Text>
          )}
        </View>

        {unassigned ? (
          /* ВЫСТАВЛЕННЫЙ ДОКУМЕНТ НЕ ПРАВИТСЯ (владелец 2026-09-22): привязка
             клиента была той же правкой и стирала реквизиты и счёт. */
          <NoticeBar
            tone="info"
            message="Документ ни к кому не привязан. Выставленный инвойс не меняется — нужен другой получатель: отмените его и выставьте новый."
          />
        ) : null}

        <InvoicePaper doc={paperDoc} />
        </View>

        {/* То, чего на бумаге нет: откуда документ и что с ним стало. */}
        {appointment || stornoOfId || creditNoteId || (client && !clientIsArchived) ? (
          <SectionCard title="Связи">
            {client && !clientIsArchived ? (
              <ValueRow
                label="Клиент"
                value={recipientName ?? client.full_name}
                onPress={() => router.push(`/clients/${client.id}`)}
              />
            ) : null}
            {appointment ? (
              <>
                {client && !clientIsArchived ? <Divider inset={16} /> : null}
                <ValueRow
                  label="Заявка"
                  value={`${formatInvoiceDate(appointment.date)} · ${appointment.time_start}`}
                  onPress={openLinkedAppointment}
                />
              </>
            ) : null}
            {stornoOfId ? (
              <>
                <Divider inset={16} />
                <ValueRow
                  label="Сторнирует"
                  value={numberById.get(stornoOfId) ?? "Открыть инвойс"}
                  onPress={() => router.push(`/invoices/${stornoOfId}` as Href)}
                />
              </>
            ) : null}
            {creditNoteId ? (
              <>
                <Divider inset={16} />
                <ValueRow
                  label="Кредит-нота"
                  value={numberById.get(creditNoteId) ?? "Открыть"}
                  onPress={() => router.push(`/invoices/${creditNoteId}` as Href)}
                />
              </>
            ) : null}
          </SectionCard>
        ) : null}

        {/* Платежи — со счётом и возвратом: на бумаге этого действия нет. */}
        {!isCreditNote && payments.length > 0 ? (
          <SectionCard title="Платежи">
            {payments.map((payment, index) => {
              const refundable = calculateInvoicePaymentRefundable(payment, payments);
              const refundDestination = invoicePaymentRefundDestination(payment, payments);
              const refundInAppointment = refundDestination === "appointment";
              return (
                <View key={payment.id}>
                  {index > 0 ? <Divider inset={16} /> : null}
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
            })}
          </SectionCard>
        ) : null}

        {/* ЧЕК ИНВОЙСА — закреплён за его оплатой; тап открывает чек. */}
        {!isCreditNote && receipts.length > 0 ? (
          <SectionCard title="Чек">
            {receipts.map((receipt, index) => (
              <View key={receipt.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <Pressable
                  onPress={() => setOpenReceipt(receipt)}
                  accessibilityRole="button"
                  accessibilityLabel={`Чек ${receipt.number}, открыть`}
                  className="flex-row items-center px-4 py-3 active:opacity-60"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-[15px] font-medium" style={{ color: t.ink }}>
                      {`Чек ${receipt.number}`}
                    </Text>
                    <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
                      {[
                        formatInvoiceDate(receipt.issued_on),
                        receipt.status === "void" ? "аннулирован" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <Text
                    className="text-base font-semibold"
                    style={{
                      color: receipt.status === "void" ? t.faint : t.ink,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatInvoiceMoney(receipt.amount, row.currency)}
                  </Text>
                </Pressable>
              </View>
            ))}
          </SectionCard>
        ) : null}
      </ScrollView>

      {/* ДЕЙСТВИЕ ЭКРАНА ОДНО И ЖИВЁТ ВНИЗУ (AGENTS: главное действие — в
          футере): пока документ ждёт денег — «Принять оплату». */}
      {awaitsPayment ? (
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <Button
            label={`${settlement.paid > 0 ? "Добавить платёж" : "Принять оплату"} · ${formatInvoiceMoney(settlement.remaining, row.currency)}`}
            onPress={openPayment}
          />
        </View>
      ) : !isCreditNote &&
        row.status !== "void" &&
        row.status !== "cancelled" &&
        receiptsQuery.isSuccess &&
        paymentsWithoutReceipt.length > 0 ? (
        // Оплачен — главное действие экрана становится «Выписать чек»: чек
        // рождается кнопкой, а не сам (владелец 2026-09-20).
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <Button label="Выписать чек" loading={issuing} onPress={() => void issueReceipts()} />
        </View>
      ) : null}

      <InvoicePaymentSheet
        visible={paymentOpen}
        total={row.total}
        paid={settlement.paid}
        remaining={settlement.remaining}
        currency={row.currency}
        businessToday={businessToday}
        brigadeId={row.brigade_id}
        accounts={paymentAccounts}
        preferredAccountId={row.account_id ?? null}
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
      <ReceiptSheet
        receipt={openReceipt}
        appointment={appointment ?? null}
        accountName={openReceipt?.account_id ? (accountById.get(openReceipt.account_id) ?? null) : null}
        onClose={() => setOpenReceipt(null)}
        // Дверь «к инвойсу» из листа ведёт на эту же страницу — лист просто
        // закрывается.
        onOpen={(href) => {
          if (href !== `/invoices/${id}`) router.push(href as Href);
        }}
      />
      <AccountEditorSheet
        visible={accountCreateOpen}
        accountId={null}
        onClose={() => setAccountCreateOpen(false)}
        presetTeamId={row.brigade_id}
      />
    </Screen>
  );
}

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
  const method = paymentMethodLabel(payment.payment_method) || null;
  const meta = [
    formatInvoiceDate(payment.occurred_on),
    accountName || "Счёт не указан",
    // Счёт «Наличные» и способ «Наличные» — одно слово дважды подряд.
    method && method !== accountName ? method : null,
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
          className="text-base font-semibold"
          style={{ color: isRefund ? t.danger : t.success, fontVariant: ["tabular-nums"] }}
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
