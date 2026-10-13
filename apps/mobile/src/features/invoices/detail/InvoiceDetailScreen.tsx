import { ScrollView, View } from "react-native";
import type { Href } from "expo-router";
import {
  calculateInvoicePaymentRefundable,
  invoiceDisplayStatus,
  invoicePaymentRefundDestination,
} from "@babun/shared/local/finance/invoice-ledger";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import { ActionMenuSheet } from "@/features/calendar/ActionMenuSheet";
import { accessGate } from "@/features/access/my-access";
import { DocumentLinkBlocks } from "@/features/documents/DocumentLinkBlocks";
import { confirmThen } from "@/lib/confirm";
import { buildInvoiceDocument } from "../document";
import { formatInvoiceMoney } from "../format";
import { InvoicePaper } from "../InvoicePaper";
import { InvoicePaymentSheet } from "../InvoicePaymentSheet";
import { InvoiceDetailFooter, InvoiceHeaderActions, InvoiceStatusLine } from "./InvoiceDetailChrome";
import { PaymentHistoryRow } from "./PaymentHistoryRow";
import { useInvoiceDetail } from "./use-invoice-detail";

export function InvoiceDetailScreen() {
  const {
    router,
    pendingAction,
    invoice,
    clientsQuery,
    appointmentsQuery,
    accountsQuery,
    tenantQuery,
    tenant,
    role,
    myAccess,
    calendarSettingsQuery,
    paymentRows,
    creditLinks,
    invoicesQuery,
    noteReceipt,
    creditNote,
    pay,
    invoiceMenu,
    sheetMenu,
    setSheetMenu,
    paymentOpen,
    setPaymentOpen,
    accountCreateOpen,
    setAccountCreateOpen,
    pdfBusy,
    businessToday,
    client,
    appointment,
    payments,
    receiptsQuery,
    settlement,
    paymentAccounts,
    accountById,
    receipts,
    paymentsWithoutReceipt,
    issueReceipts,
    sharePdf,
  } = useInvoiceDetail();

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
      else if (next === "pay" && docWrite && awaitsPayment) openPayment();
      else if (next === "receipt" && docWrite) issueReceipts();
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
  // «Меняет» — весь блок (04.10): оплата, чек, возврат и меню — у всех, кто
  // «Документы: Видит и меняет» в команде инвойса; без команды — владельцу.
  const docWrite =
    owner ||
    (!!row.brigade_id &&
    accessGate({
      role,
      map: myAccess,
      blockKey: "finance.documents",
      scope: "calendar",
      teamId: row.brigade_id,
    }) === "write");
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
          <InvoiceHeaderActions
            docWrite={docWrite}
            pdfBusy={pdfBusy}
            hasMenu={hasMenu}
            onShare={sharePdf}
            onMenu={openMenu}
          />
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
      >
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 4 }}>
        {/* Статус — одной строкой над бумагой: на самой бумаге его нет. */}
        <InvoiceStatusLine
          invoice={row}
          settlement={settlement}
          today={businessToday}
          isCreditNote={isCreditNote}
          isOverdue={isOverdue}
          awaitsPayment={awaitsPayment}
          status={status}
        />

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
                    // ВОЗВРАТ — ЧЕРЕЗ КРЕДИТ-НОТУ (04.10): документ и деньги одним
                    // движением; старый возврат без документа оставлял долг.
                    onRefund={
                      docWrite && refundDestination === "invoice" && refundable > 0
                        ? () =>
                            router.push(
                              `/invoices/credit-note?invoiceId=${row.id}&amount=${refundable}` as Href,
                            )
                        : undefined
                    }
                  />
                </View>
              );
            })}
          </SectionCard>
        ) : null}

      </ScrollView>

      <InvoiceDetailFooter
        awaitsPayment={awaitsPayment}
        docWrite={docWrite}
        canIssueReceipt={
          !isCreditNote &&
          row.status !== "void" &&
          row.status !== "cancelled" &&
          receiptsQuery.isSuccess &&
          paymentsWithoutReceipt.length > 0
        }
        paymentLabel={`${settlement.paid > 0 ? "Добавить платёж" : "Принять оплату"} · ${formatInvoiceMoney(settlement.remaining, row.currency)}`}
        pdfBusy={pdfBusy}
        onPayment={openPayment}
        onIssueReceipt={issueReceipts}
        onShare={() => void sharePdf()}
      />

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
      <AccountEditorSheet
        visible={accountCreateOpen}
        accountId={null}
        onClose={() => setAccountCreateOpen(false)}
        presetTeamId={row.brigade_id}
      />
    </Screen>
  );
}
