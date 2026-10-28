import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { persistInvoiceLanguage } from "@/features/finances/persist-invoice-language";
import {
  deleteInvoice,
  getInvoice,
  InvoiceAlreadyIssuedError,
  issueInvoice,
  updateInvoice,
  listInvoices,
  setInvoiceLanguage,
  type IssueInvoiceDraft,
} from "@babun/shared/db/repositories/invoices";
import type { InvoiceLanguage } from "@/lib/paper/dictionary";
import {
  listInvoiceAppointmentMoney,
  listInvoicePayments,
  recordInvoicePayment,
  type RecordInvoicePaymentDraft,
} from "@babun/shared/db/repositories/invoice-payments";
import { supabase } from "@/lib/supabase";
import { rpcArgs } from "@babun/shared/db/rpc-args";
import { useTenantId } from "@/lib/tenant";
import {
  invoicePaymentsQueryKey,
  invoicesQueryKey,
} from "@/lib/company-query-keys";

/**
 * Счета тенанта — целиком либо СРЕЗОМ ПО КЛИЕНТУ.
 *
 * Срез не косметика: строка «Счета и чеки» на карточке клиента поднимала всю
 * историю инвойсов компании ради одного числа рядом с именем — чеки рядом уже
 * грузились срезом (`useReceipts({ clientId })`), а репозиторий фильтр по
 * клиенту умеет с самого начала (`listInvoices`, `opts.clientId` → `.eq`).
 *
 * Ключ у среза свой, с разделителем — как у `detail` и `next-number`; общий
 * префикс `["invoices"]` сохранён, поэтому одна `invalidateQueries` по-прежнему
 * освежает и полный список, и все срезы.
 */
export function useInvoices(filter?: { clientId?: string | null }) {
  const tenantId = useTenantId();
  const clientId = filter?.clientId ?? null;
  return useQuery({
    queryKey: clientId
      ? ["invoices", tenantId, "by-client", clientId]
      : invoicesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () =>
      listInvoices(supabase, tenantId as string, clientId ? { clientId } : {}),
  });
}

export function useInvoice(id: string | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["invoices", tenantId, "detail", id],
    enabled: !!tenantId && !!id,
    queryFn: () => getInvoice(supabase, id as string),
  });
}

export interface NextInvoiceNumber {
  seq: number;
  number: string;
  /** Можно ли двигать номер вручную: только владелец, и только вперёд — не
   *  ниже уже выданного. Пропущенные при переходе номера остаются дырой. */
  canSetStart: boolean;
}

/**
 * Номер, который получит СЛЕДУЮЩИЙ инвойс этого юрлица.
 *
 * Считает сервер по той же серии, из которой выпуск берёт номер
 * (`document_sequences`, STORY-101): предпросмотр не имеет права показывать
 * один номер, а документ получать другой. Это прогноз — пока человек
 * заполняет форму, коллега может выставить свой счёт, и номер сдвинется.
 *
 * Серия — у юрлица: у каждого свои INV, REC и CN, команда в номер не входит.
 * `companyId` пусто — основное юрлицо.
 */
export function useNextInvoiceSeries(
  year: number,
  companyId?: string | null,
  enabled = true,
  /** Серия какого документа: у юрлица свои INV и RC (чек — «номер
   *  чека — так же, как номер инвойса»). */
  docType: "invoice" | "receipt" | "credit_note" = "invoice",
) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["invoices", tenantId, "next-number", year, companyId ?? null, docType],
    // Партнёру без «Документы: Выставляет» сервер номер не показывает
    // (`peek_document_number` отказывает) — такой экран не спрашивает.
    enabled: !!tenantId && enabled,
    // Свежесть важнее кэша: номер меняется от каждого выставленного счёта.
    staleTime: 0,
    queryFn: () => peekNextDocumentNumber(year, companyId ?? null, docType),
  });
}

/** Следующий номер серии прямо сейчас — для места, которому хук не годится
 *  (вопрос перед удалением строится в момент нажатия). */
export async function peekNextDocumentNumber(
  year: number,
  companyId: string | null,
  docType: "invoice" | "receipt" | "credit_note" = "invoice",
): Promise<NextInvoiceNumber | null> {
  const { data, error } = await supabase.rpc(
    "peek_document_number",
    rpcArgs<"peek_document_number">({
      p_legal_entity_id: companyId,
      p_doc_type: docType,
      p_year: year,
    }),
  );
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? { seq: row.seq, number: row.number, canSetStart: row.can_set_start }
    : null;
}

/** Только строка номера — для мест, где счётчик не правят. */
export function useNextInvoiceNumber(year: number, companyId?: string | null, enabled = true) {
  const series = useNextInvoiceSeries(year, companyId, enabled);
  return { ...series, data: series.data?.number ?? null };
}

/**
 * «Следующий инвойс — 104»: ручной номер серии, в любой момент и только
 * вперёд — номер не ниже уже выданного (отказ сервер называет словами).
 * Переход вперёд оставляет в серии дыру из пропущенных номеров, а закон о VAT
 * требует сплошную нумерацию, поэтому экран переспрашивает человека, прежде
 * чем вызвать эту мутацию (`InvoiceNumberRow`).
 */
export function useSetInvoiceNextNumber() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // Отказ называет сама строка номера («Номер не сохранён: …»,
    // `InvoiceNumberRow`) — общее «Проверьте соединение» поверх неё врало бы
    // про связь.
    meta: { errorHandled: true },
    mutationFn: async (input: {
      companyId: string;
      year: number;
      number: number;
      docType?: "invoice" | "receipt";
    }) => {
      const { error } = await supabase.rpc("set_document_series_start", {
        p_legal_entity_id: input.companyId,
        p_doc_type: input.docType ?? "invoice",
        p_year: input.year,
        p_next_number: input.number,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["invoices", tenantId, "next-number"] }),
  });
}

/**
 * Связи кредит-нот с их инвойсами.
 *
 * `cancel_invoice` пишет сторно в ту же таблицу invoices с kind='credit_note'
 * и ссылкой credit_note_of_id, но shared-репозиторий эти колонки не маппит —
 * без отдельной связки сторно печаталось бы в списках как
 * «Инвойс CN-… · Оплачен» с минусовой суммой.
 */
interface CreditNoteLinks {
  /** id кредит-ноты → id сторнированного инвойса. */
  originalByNoteId: Map<string, string>;
  /** id инвойса → id его кредит-ноты. */
  noteByInvoiceId: Map<string, string>;
}

export function useCreditNoteLinks() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["invoices", tenantId, "credit-notes"],
    enabled: !!tenantId,
    queryFn: async (): Promise<CreditNoteLinks> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, credit_note_of_id")
        .eq("tenant_id", tenantId as string)
        .eq("kind", "credit_note");
      if (error) throw new Error(error.message);
      const originalByNoteId = new Map<string, string>();
      const noteByInvoiceId = new Map<string, string>();
      for (const row of data ?? []) {
        if (!row.credit_note_of_id) continue;
        originalByNoteId.set(row.id, row.credit_note_of_id);
        noteByInvoiceId.set(row.credit_note_of_id, row.id);
      }
      return { originalByNoteId, noteByInvoiceId };
    },
  });
}

export function useInvoicePayments() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: invoicePaymentsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listInvoicePayments(supabase, tenantId as string),
  });
}

/** Деньги записей, принятые мимо их инвойсов (`listInvoiceAppointmentMoney`):
 *  остаток инвойса по записи — за вычетом уже полученного записью. Ключ — под
 *  «transactions»: его сбрасывает и оплата записи, и оплата инвойса. */
export function useInvoiceAppointmentMoney() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "invoice-appointment-money"],
    enabled: !!tenantId,
    queryFn: () => listInvoiceAppointmentMoney(supabase, tenantId as string),
  });
}

function invalidateInvoices(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  // Чек рождается СЕРВЕРОМ на каждый приём денег (issue_receipt_for_income),
  // а отказ — кредит-нотой: без инвалидации панель «Документы» показывала
  // список чеков без только что рождённого.
  qc.invalidateQueries({ queryKey: ["receipts"] });
  // Оплата и возврат по инвойсу — строки журнала записи: её «История
  // платежей» живёт под своим ключом.
  qc.invalidateQueries({ queryKey: ["appointment-ledger"] });
  // Кредит-нота с возвратом и отмена инвойса двигают ДЕНЬГИ: строки возврата
  // ложатся в журнал счёта (`_refund_invoice_money`). Остатки счетов и их НДС
  // живут под `accounts`, долги — под `debts`; без них плитки счетов до минуты
  // показывали прежний остаток. Оплата инвойса добавляла их сама.
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["debts"] });
}

export function useIssueInvoice() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // ЯЗЫК ПИШЕТСЯ ВТОРЫМ ШАГОМ И НЕ ВАЛИТ ВЫСТАВЛЕНИЕ. Серверная функция
    // `issue_invoice` его не принимает (добавить параметр — значит создать
    // перегрузку рядом со старой), а язык не деньги: если запись не прошла,
    // счёт остаётся русским, а язык меняют через «Изменить инвойс» (на странице
    // выставленного языка нет). Ронять из-за этого выставленный документ было
    // бы куда хуже — но и молчать нельзя: вернувшийся документ
    // несёт язык, который реально записан, и экран говорит о расхождении.
    // Вторая попытка — на случай одного моргания сети; «записан» — только
    // после сверки строки (`setInvoiceLanguage`), а не по отсутствию ошибки.
    // `repeat` — этот id запроса уже уходил: документ им, возможно, создан
    // (`InvoiceAlreadyIssuedError`).
    mutationFn: async ({
      language,
      repeat,
      ...draft
    }: IssueInvoiceDraft & { language?: InvoiceLanguage; repeat?: boolean }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      let invoice;
      try {
        invoice = await issueInvoice(supabase, tenantId, draft, { repeat });
      } catch (error) {
        // ПРОШЛАЯ ПОПЫТКА ВЫСТАВИЛА ДОКУМЕНТ, А ЯЗЫК ЗАПИСАТЬ НЕ УСПЕЛА (он —
        // вторым шагом). Без этого шага повтор уводил на выставленный инвойс,
        // и бумага оставалась русской — на английском черновике.
        if (
          error instanceof InvoiceAlreadyIssuedError &&
          language &&
          error.invoice.language !== language
        ) {
          await persistInvoiceLanguage(() => setInvoiceLanguage(supabase, error.invoice.id, language));
        }
        throw error;
      }
      if (language && language !== "ru") {
        const saved = await persistInvoiceLanguage(() =>
          setInvoiceLanguage(supabase, invoice.id, language),
        );
        if (saved) return { ...invoice, language };
      }
      return invoice;
    },
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** ПРАВКА ВЫСТАВЛЕННОГО ИНВОЙСА НА МЕСТЕ — тот же номер. Язык
 *  — вторым шагом, как при выставлении. */
export function useUpdateInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async ({
      language,
      ...draft
    }: Omit<IssueInvoiceDraft, "request_id" | "link_to_tx_id"> & { language?: InvoiceLanguage }) => {
      const invoice = await updateInvoice(supabase, id, draft);
      // Правка уже записана: язык — вторым шагом и НЕ валит её (как у
      // выставления). Иначе сбой языка отвергал бы всю мутацию — экран говорил бы
      // «ошибка» про сохранённые суммы, а кэш инвойса оставался бы старым.
      if (language && language !== invoice.language) {
        const saved = await persistInvoiceLanguage(() => setInvoiceLanguage(supabase, id, language));
        if (saved) return { ...invoice, language };
      }
      return invoice;
    },
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** УДАЛЕНИЕ КРЕДИТ-НОТЫ, ПОКА ЕЁ НЕ ОТПРАВИЛИ (отменил
 *  инвойс, а клиент: «ладно, плачу»). Последняя в серии, без движения денег;
 *  инвойс возвращается как был (`delete_credit_note`). */
export function useDeleteCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.rpc("delete_credit_note", { p_note_id: noteId });
      if (error) throw new Error(error.message);
    },
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** УДАЛЕНИЕ ПОСЛЕДНЕГО ИНВОЙСА СЕРИИ — номер возвращается. */
export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteInvoice(supabase, id),
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/**
 * ЧАСТИЧНАЯ КРЕДИТ-НОТА: инвойс остаётся в силе, к оплате —
 * сумма минус сторнированное; получено больше — разница возвращается клиенту
 * тем же движением (`issue_partial_credit_note`). Id ноты = id запроса.
 */
export function useIssuePartialCreditNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: {
      requestId: string;
      amount: number;
      reason: string | null;
      language: string;
      /** Платёж, с которого вернуть деньги первыми; без него — с новейших. */
      paymentId?: string | null;
    }) => {
      const base = {
        p_invoice_id: id,
        p_request_id: input.requestId,
        p_amount: input.amount,
        ...(input.reason ? { p_reason: input.reason } : {}),
        p_language: input.language,
      };
      let { data, error } = await supabase.rpc("issue_partial_credit_note", {
        ...base,
        ...(input.paymentId ? { p_payment_id: input.paymentId } : {}),
      });
      // База без p_payment_id (миграция ещё не накачена) отвечает «функции с
      // такими аргументами нет» — тогда прежний вызов: возврат с новейших
      // платежей лучше, чем никакого.
      if (error && input.paymentId && error.code === "PGRST202") {
        ({ data, error } = await supabase.rpc("issue_partial_credit_note", base));
      }
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Кредит-нота не подтверждена сервером");
      return data;
    },
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/**
 * Канонный отказ: сервер выпускает кредит-ноту и
 * помечает инвойс «Отменён». Оплаченный документ сервер не отменит — попросит
 * сначала оформить возврат; его текст показывается человеку как есть.
 */
export function useCancelInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (reason?: string) => {
      const { data, error } = await supabase.rpc("cancel_invoice", {
        p_invoice_id: id,
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

export function useRecordInvoicePayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: RecordInvoicePaymentDraft) =>
      recordInvoicePayment(supabase, invoiceId, draft),
    // И после отказа: «платёж не подтверждён сервером» бывает и у
    // записанного — остаток на экране обязан быть свежим, иначе повтор
    // проведёт вторую оплату.
    onSettled: () => {
      invalidateInvoices(qc);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    meta: { errorHandled: true },
  });
}

