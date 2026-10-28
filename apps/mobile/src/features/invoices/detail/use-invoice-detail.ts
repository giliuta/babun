import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import type { RecordInvoicePaymentDraft } from "@babun/shared/db/repositories/invoice-payments";
import { randomUuid } from "@babun/shared/sync";
import {
  paymentsAwaitingReceipt,
  receiptRefusal,
  receiptRefusalText,
} from "@/lib/receipt-eligibility";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import type { ActionMenu } from "@/components/blocks/ActionMenuSheet";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useReceipt, useReceipts } from "@/features/finances/receipts-queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useMyAccess } from "@/session/access-queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole, useTenant } from "@/session/tenant";
import { notify } from "@/lib/notify";
import { todayYmd } from "@/lib/paper/format";
import { useInvoiceMenu } from "@/features/finances/invoice-menu";
import {
  useCreditNoteLinks,
  useInvoice,
  useInvoiceAppointmentMoney,
  useInvoicePayments,
  useInvoices,
  useRecordInvoicePayment,
} from "@/features/finances/invoices-queries";
import { prepareInvoicePdf, shareInvoicePdf, type InvoicePdfInput } from "../share-pdf";
import { accessGate } from "@/session/my-access";
import { earliestPayment } from "./payment-meta";
import { sendPayment } from "./payment-request";

/** Queries, sheet state and the PDF / receipt actions of the invoice page. */
export function useInvoiceDetail() {
  const router = useRouter();
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  // ДЕЙСТВИЕ ИЗ МЕНЮ СПИСКА (долгое нажатие в «Документах» — «Поделиться
  // PDF», «Принять оплату», «Выписать чек»): страница делает его сама, когда
  // всё нужное загружено (эффект в InvoiceDetailScreen), и стирает его из адреса.
  const invoice = useInvoice(id);
  const clientsQuery = useClients();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const appointmentsQuery = useAppointments();
  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data]);
  const accountsQuery = useAccountsWithBalances();
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const tenantQuery = useTenant();
  const tenant = tenantQuery.data;
  // ПАРТНЁР С «ДОКУМЕНТАМИ»: «Видит» — бумага, платежи, чек; «Видит и
  // меняет» в команде инвойса — весь блок, как у владельца: оплата, чек,
  // возврат, отмена и меню (`docWrite` в `InvoiceDetailScreen`).
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
  // на странице, в PDF и в тексте одинаково.
  const creditNoteOfId = creditLinks.data?.originalByNoteId.get(id) ?? null;
  // Кредит-нота к ЧЕКУ (возврат по чеку) ссылается на чек, а не на
  // инвойс: номер — его.
  const noteReceipt = useReceipt(invoice.data?.credit_note_of_receipt_id ?? null).data ?? null;
  const isCreditNote = invoice.data?.kind === "credit_note";
  const noteReceiptNumber = noteReceipt?.number ?? null;
  const creditNote = useMemo(
    () =>
      creditNoteOfId
        ? { originalNumber: numberById.get(creditNoteOfId) ?? null }
        : isCreditNote
          ? { originalNumber: noteReceiptNumber, ofReceipt: true }
          : null,
    [creditNoteOfId, numberById, isCreditNote, noteReceiptNumber],
  );
  const pay = useRecordInvoicePayment(id);
  // Id платежа живёт на странице, а не в листе: закрыть и открыть лист после
  // потерянного ответа — тот же платёж, а не второй (`sendPayment`).
  const paymentRequestId = useRef(randomUuid());
  const submitPayment = (value: Omit<RecordInvoicePaymentDraft, "request_id">) =>
    sendPayment(
      paymentRequestId,
      async (requestId) => {
        await pay.mutateAsync({ ...value, request_id: requestId });
      },
      randomUuid,
    );
  const invoiceMenu = useInvoiceMenu();
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // ЧЕК — ТОЛЬКО У ИНВОЙСА: отдельных чеков нет, чек выставляют на выставленный
  // инвойс — на оплату, принятую по нему. Инвойс оплачен — внизу «Выписать чек»,
  // выписанный чек стоит
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
  // Деньги записи, принятые мимо инвойса, — в «Получено» бумаги и в остаток
  // («Получено €260 · К оплате €40»): работа одна, клиент за неё уже платил.
  const appointmentMoney = useInvoiceAppointmentMoney().data?.[id] ?? 0;
  const settlement = useMemo(
    () => invoice.data ? calculateInvoiceSettlement(invoice.data, payments, appointmentMoney) : null,
    [invoice.data, payments, appointmentMoney],
  );
  // ДОКУМЕНТ БЕЗ КЛИЕНТА МОЖНО ПРИВЯЗАТЬ: сверху сказано, что он ни к чему не
  // присвоен, и предложено выбрать клиента, чтобы не потерялся. Идёт тем же путём, что правка
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
  const receiptTransactionIds = useMemo(
    () => new Set(receipts.flatMap((r) => (r.transaction_id ? [r.transaction_id] : []))),
    [receipts],
  );
  const paymentsWithoutReceipt = useMemo(
    () => paymentsAwaitingReceipt(payments, receiptTransactionIds),
    [payments, receiptTransactionIds],
  );

  // «ВЫПИСАТЬ ЧЕК» ОТКРЫВАЕТ ЧЕК, А НЕ ВЫДАЁТ ЕГО СРАЗУ: человек проверяет, как он
  // будет выглядеть, при нужде правит, и только тогда выставляет. Составитель
  // заполнен этой оплатой: клиент, счёт, строки инвойса. Платежей без чека
  // несколько (доплаты) — по одному, первым самый ранний; вернулся — кнопка
  // ведёт к следующему.
  const issueReceipts = () => {
    // Кнопка и меню не предлагают чек там, где его не выпустить; сюда можно
    // прийти только ссылкой, и тогда человеку называют причину, а не молчат.
    const refusal = invoice.data
      ? receiptRefusal({ invoice: invoice.data, payments, receiptTransactionIds })
      : null;
    if (refusal) {
      notify("Чек не выписывается", receiptRefusalText(refusal));
      return;
    }
    const payment = earliestPayment(paymentsWithoutReceipt);
    if (!payment) return;
    router.push({
      pathname: "/documents/receipt-new",
      params: { transactionId: payment.id },
    } as unknown as Href);
  };

  // Одна печать за раз: действие из меню и тап по кнопке не должны запускать
  // две сборки PDF разом (состояние `pdfBusy` до перерисовки этого не видит).
  const pdfRunning = useRef(false);
  /** Что печатается — одно для заготовки и для «Поделиться»: иначе готовый
   *  файл не совпал бы с нажатием и печать пошла бы заново. */
  const pdfInput: InvoicePdfInput | null =
    invoice.data && settlement && (tenant || invoice.data.seller_snapshot)
      ? {
          // ЯЗЫК ДОКУМЕНТА ЕДЕТ ВМЕСТЕ С НИМ. Он выбран при выставлении и лежит
          // в строке инвойса; без него PDF уходил клиенту всегда по-русски,
          // даже собранный на английском.
          language: invoice.data.language as "ru" | "en" | undefined,
          invoice: invoice.data,
          tenant: tenant ?? undefined,
          client,
          settlement,
          payments,
          accountNames: accountById,
          businessToday,
          creditNote,
        }
      : null;
  // «Меняет» — весь блок: оплата, чек, возврат, «Поделиться» и меню — у всех,
  // кто «Документы: Видит и меняет» в команде инвойса; без команды — владельцу.
  const docWrite =
    role === "owner" ||
    (!!invoice.data?.brigade_id &&
      accessGate({
        role,
        map: myAccess,
        blockKey: "finance.documents",
        scope: "calendar",
        teamId: invoice.data.brigade_id,
      }) === "write");
  // PDF ПЕЧАТАЕТСЯ ЗАРАНЕЕ, пока страницу смотрят: печать в скрытом WebView
  // занимает секунды, и «Поделиться» ~5 с крутило спиннер.
  // Тем, кто поделиться не может, печатать нечего. Пауза — чтобы не спорить
  // с первой отрисовкой страницы; одинаковый документ второй раз не печатается.
  const preparedInput = useRef<InvoicePdfInput | null>(null);
  preparedInput.current = pdfInput;
  const pdfReady = docWrite && !!pdfInput;
  useEffect(() => {
    if (!pdfReady) return;
    const timer = setTimeout(() => {
      if (preparedInput.current) prepareInvoicePdf(preparedInput.current);
    }, 800);
    return () => clearTimeout(timer);
  }, [pdfReady, invoice.data, settlement, payments, tenant, client, accountById, businessToday, creditNote]);

  const sharePdf = async () => {
    if (!invoice.data || !settlement || pdfRunning.current) return;
    if (!pdfInput) {
      notify(
        "PDF пока недоступен",
        "Реквизиты ещё загружаются. Попробуйте через несколько секунд.",
      );
      return;
    }
    pdfRunning.current = true;
    setPdfBusy(true);
    try {
      await shareInvoicePdf(pdfInput);
    } catch (error) {
      notify("Не удалось поделиться PDF", (error as Error).message);
    } finally {
      pdfRunning.current = false;
      setPdfBusy(false);
    }
  };

  return {
    router,
    id,
    action,
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
    submitPayment,
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
    receiptTransactionIds,
    issueReceipts,
    sharePdf,
    docWrite,
  };
}
