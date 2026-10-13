import { useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  calculateInvoicePaymentRefundable,
  calculateInvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
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
  useInvoicePayments,
  useInvoices,
  useRecordInvoicePayment,
} from "@/features/finances/invoices-queries";
import { shareInvoicePdf } from "../share-pdf";
import { earliestPayment } from "./payment-meta";

/** Queries, sheet state and the PDF / receipt actions of the invoice page. */
export function useInvoiceDetail() {
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
  const invoiceMenu = useInvoiceMenu();
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
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
    const payment = earliestPayment(paymentsWithoutReceipt);
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

  return {
    router,
    id,
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
  };
}
