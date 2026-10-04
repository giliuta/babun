import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
import { ICON } from "@/components/ui/tokens";
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
import { useInvoiceMenu } from "@/features/invoices/invoice-menu";
import { ActionMenuSheet, type ActionMenu } from "@/features/calendar/ActionMenuSheet";
import { InvoiceRefundSheet } from "@/features/invoices/InvoiceRefundSheet";
import { shareInvoicePdf } from "@/features/invoices/share-pdf";
import { buildInvoiceDocument } from "@/features/invoices/document";
import { InvoiceStatusBadge } from "@/features/invoices/InvoiceStatusBadge";
import { InvoicePaper } from "@/features/invoices/InvoicePaper";
import {
  useCreditNoteLinks,
  useInvoice,
  useInvoicePayments,
  useInvoices,
  useRecordInvoicePayment,
  useRefundInvoicePayment,
} from "@/features/invoices/queries";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
import { accessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useReceipt, useReceipts } from "@/features/documents/receipts-queries";
import { DocumentLinkBlocks } from "@/features/documents/DocumentLinkBlocks";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

export default function InvoiceDetailScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  // ДЕЙСТВИЕ ИЗ МЕНЮ СПИСКА (04.10: долгое нажатие в «Документах» — «Поделиться
  // PDF», «Принять оплату», «Выписать чек»): страница открывается и делает его
  // сама, один раз, когда всё нужное загружено.
  const pendingAction = useRef<string | null>(action ?? null);
  const invoice = useInvoice(id);
  const clientsQuery = useClients();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const appointmentsQuery = useAppointments();
  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data]);
  const accountsQuery = useAccountsWithBalances();
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const tenantQuery = useTenant();
  const tenant = tenantQuery.data;
  // ПАРТНЁР С «ДОКУМЕНТАМИ» (03.10): «Видит» — бумага, платежи, чек; с
  // «Выставляет» — ещё язык бумаги и «Выписать чек». Принять оплату, вернуть
  // деньги и отменить инвойс — только владельцу (сервер так и держит).
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
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
  // Кредит-нота к ЧЕКУ (возврат по чеку, 04.10) ссылается на чек, а не на
  // инвойс: номер — его.
  const noteReceipt = useReceipt(invoice.data?.credit_note_of_receipt_id ?? null).data ?? null;
  const creditNote = creditNoteOfId
    ? { originalNumber: numberById.get(creditNoteOfId) ?? null }
    : invoice.data?.kind === "credit_note"
      ? { originalNumber: noteReceipt?.number ?? null, ofReceipt: true }
      : null;
  const pay = useRecordInvoicePayment(id);
  const refund = useRefundInvoicePayment(id);
  const invoiceMenu = useInvoiceMenu();
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<InvoicePaymentLedger | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  // ЧЕК — ТОЛЬКО У ИНВОЙСА (владелец 2026-09-30: «отдельно чеки пока что не
  // делай; чек можно выставить на выставленный инвойс — на оплату, принятую
  // по нему»). Инвойс оплачен — внизу «Выписать чек», выписанный чек стоит
  // блоком на странице и открывается листом.
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");

  const client = useMemo(
    () => clients.find((item) => item.id === invoice.data?.client_id),
    [clients, invoice.data?.client_id],
  );
  const appointment = appointments.find((item) => item.id === invoice.data?.appointment_id);
  const payments = useMemo(() => paymentRows.data?.[id] ?? [], [id, paymentRows.data]);
  // Чеки инвойса — и его, и выписанные на его платежи раньше него.
  const incomeIds = useMemo(
    () => payments.filter((p) => p.type === "income").map((p) => p.id),
    [payments],
  );
  const receiptsQuery = useReceipts({ invoiceId: id, transactionIds: incomeIds, enabled: !!id });
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
  // ИМЕНА — СО СКРЫТЫМИ И УДАЛЁННЫМИ: оплата на счёте, который потом скрыли
  // или удалили, не теряет его имя ни в ленте, ни в PDF. Пикеры оплаты
  // по-прежнему берут только живые счета (`accounts`).
  const namedAccountsQuery = useAccountsWithBalances({ includeInactive: true, includeDeleted: true });
  const accountById = useMemo(
    () => new Map((namedAccountsQuery.data ?? accounts).map((a) => [a.id, a.name])),
    [namedAccountsQuery.data, accounts],
  );
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

  // «ВЫПИСАТЬ ЧЕК» ОТКРЫВАЕТ ЧЕК, А НЕ ВЫДАЁТ ЕГО СРАЗУ (владелец 2026-10-03:
  // «нажимаю — оно сразу заполняет, и я всё равно проверяю, как это будет
  // выглядеть, может что-то подправить, — и тогда выставляю чек»). Составитель
  // заполнен этой оплатой: клиент, счёт, строки инвойса. Платежей без чека
  // несколько (доплаты) — по одному, первым самый ранний; вернулся — кнопка
  // ведёт к следующему.
  const issueReceipts = () => {
    const payment = [...paymentsWithoutReceipt].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )[0];
    if (!payment) return;
    router.push({
      pathname: "/documents/receipt-new",
      params: { transactionId: payment.id },
    } as unknown as Href);
  };

  const sharePdf = async () => {
    if (!invoice.data || !settlement) return;
    if (!tenant && !invoice.data.seller_snapshot) {
      notify(
        "PDF пока недоступен",
        "Реквизиты ещё загружаются. Попробуйте через несколько секунд.",
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
  const isCreditNote = stornoOfId != null || row.kind === "credit_note";
  const invoiceById = (target: string | null) =>
    target ? ((invoicesQuery.data ?? []).find((item) => item.id === target) ?? null) : null;
  const stornoOfInvoice = invoiceById(stornoOfId);
  // Все ноты инвойса — частичные и полная (04.10), плашками в «Документах».
  const creditNotes = (invoicesQuery.data ?? []).filter(
    (item) => item.kind === "credit_note" && item.credit_note_of_id === row.id,
  );
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

  if (pendingAction.current && receiptsQuery.isSuccess) {
    const next = pendingAction.current;
    pendingAction.current = null;
    setTimeout(() => {
      if (next === "share" && docWrite) void sharePdf();
      else if (next === "pay" && owner && awaitsPayment) openPayment();
      else if (next === "receipt") issueReceipts();
    }, 450);
  }

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
  const owner = role === "owner";
  const docWrite =
    owner ||
    accessGate({
      role,
      map: myAccess,
      blockKey: "finance.documents",
      scope: "calendar",
      teamId: row.brigade_id ?? null,
    }) === "write";
  // «⋯» — ДЕЙСТВИЯ С ДОКУМЕНТОМ, те же, что долгим нажатием в «Документах»
  // (`useInvoiceMenu`, владелец 04.10). Языка и «Поделиться» в меню нет.
  const menuContext = {
    all: invoicesQuery.data ?? [],
    payments,
    hasReceipt: receipts.length > 0,
    onDeleted: () => {
      if (router.canGoBack()) router.back();
      else router.replace("/finances?view=documents" as Href);
    },
  };
  const hasMenu = invoiceMenu.actionsFor(row, menuContext).length > 0;
  const openMenu = () => setSheetMenu(invoiceMenu.menuFor(row, menuContext));

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={row.number}
        right={
          <View style={{ flexDirection: "row" }}>
            {/* «Документы: Видит» — смотрит, но не отправляет (владелец 04.10). */}
            {docWrite ? (
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
            ) : null}
            {hasMenu ? (
              <Pressable
                onPress={openMenu}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Ещё действия"
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
              >
                <MoreHorizontal color={t.body} size={ICON.sm} />
              </Pressable>
            ) : null}
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

        {/* ТО, ЧЕГО НА БУМАГЕ НЕТ, — БЛОКАМИ ПРОДУКТА, как на странице чека
            (владелец 04.10: «в нашей архитектуре»; «кредит-нота и чек
            закрепляются за инвойсом — сразу в одном файле»): клиент, объект,
            запись и документы инвойса — чеки, кредит-нота, сторнированный
            инвойс — плашками «Файлов». */}
        <DocumentLinkBlocks
          client={client && !clientIsArchived ? client : null}
          locationId={row.location_id ?? null}
          appointment={appointment ?? null}
          onOpenAppointment={openLinkedAppointment}
          documents={[
            ...(stornoOfInvoice ? [{ type: "invoice" as const, item: stornoOfInvoice }] : []),
            ...(noteReceipt ? [{ type: "receipt" as const, item: noteReceipt }] : []),
            ...creditNotes.map((note) => ({ type: "invoice" as const, item: note })),
            ...(isCreditNote ? [] : receipts.map((receipt) => ({ type: "receipt" as const, item: receipt }))),
          ]}
        />

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
                      owner && refundDestination === "invoice"
                        ? () => setRefundTarget(payment)
                        : undefined
                    }
                  />
                </View>
              );
            })}
          </SectionCard>
        ) : null}

      </ScrollView>

      {/* ДЕЙСТВИЕ ЭКРАНА ОДНО И ЖИВЁТ ВНИЗУ (AGENTS: главное действие — в
          футере): пока документ ждёт денег — «Принять оплату». */}
      {awaitsPayment && owner ? (
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <Button
            label={`${settlement.paid > 0 ? "Добавить платёж" : "Принять оплату"} · ${formatInvoiceMoney(settlement.remaining, row.currency)}`}
            onPress={openPayment}
          />
        </View>
      ) : docWrite &&
        !awaitsPayment &&
        !isCreditNote &&
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
          <Button label="Выписать чек" onPress={issueReceipts} />
        </View>
      ) : !docWrite ? null : (
        // ШАГОВ НЕ ОСТАЛОСЬ — ДОКУМЕНТ ОТПРАВЛЯЮТ, как у чека (владелец 04.10:
        // «на чеке внизу „Поделиться PDF“ есть, а в инвойсе нет — расхождение
        // в архитектуре; то же и в кредит-ноте»). Оплачен с чеком, отменён,
        // кредит-нота — внизу «Поделиться PDF».
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <Button label="Поделиться PDF" loading={pdfBusy} onPress={() => void sharePdf()} />
        </View>
      )}

      <ActionMenuSheet menu={sheetMenu} onClose={() => setSheetMenu(null)} />

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
