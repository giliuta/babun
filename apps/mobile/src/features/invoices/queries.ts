import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import {
  deleteInvoice,
  getInvoice,
  issueInvoice,
  updateInvoice,
  listInvoices,
  setInvoiceLanguage,
  type IssueInvoiceDraft,
} from "@babun/shared/db/repositories/invoices";
import type { InvoiceLanguage } from "./dictionary";
import {
  listInvoicePayments,
  recordInvoicePayment,
  type RecordInvoicePaymentDraft,
} from "@babun/shared/db/repositories/invoice-payments";
import { supabase } from "@/lib/supabase";
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
  /** Можно ли задать старт серии: владелец, и в серии года ещё нет ни
   *  одного инвойса. Потом номер двигает только выпуск. */
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
  /** Серия какого документа: у юрлица свои INV и RC (чек — 04.10, «номер
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
    queryFn: async (): Promise<NextInvoiceNumber | null> => {
      const { data, error } = await supabase.rpc("peek_document_number", {
        p_legal_entity_id: companyId ?? null,
        p_doc_type: docType,
        p_year: year,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : null;
      return row
        ? { seq: row.seq, number: row.number, canSetStart: row.can_set_start }
        : null;
    },
  });
}

/** Только строка номера — для мест, где счётчик не правят. */
export function useNextInvoiceNumber(year: number, companyId?: string | null, enabled = true) {
  const series = useNextInvoiceSeries(year, companyId, enabled);
  return { ...series, data: series.data?.number ?? null };
}

/**
 * «Первый инвойс — 104»: старт серии при переходе из прежней программы.
 * Сервер принимает его, только пока в серии года нет ни одного инвойса —
 * дальше номер двигает лишь выпуск (перескок дал бы дыру в серии, а закон
 * о VAT требует сплошную нумерацию).
 */
export function useSetInvoiceNextNumber() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // Отказ называет сама строка номера («Номер не сохранён: …»,
    // `InvoiceNumberRow`) — общее «Проверьте соединение» поверх неё врало бы
    // про связь (аудит 017, 03.10).
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
export interface CreditNoteLinks {
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

function invalidateInvoices(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  // Чек рождается СЕРВЕРОМ на каждый приём денег (issue_receipt_for_income),
  // а отказ — кредит-нотой: без инвалидации панель «Документы» показывала
  // список чеков без только что рождённого.
  qc.invalidateQueries({ queryKey: ["receipts"] });
  // Оплата и возврат по инвойсу — строки журнала записи: её «История
  // платежей» живёт под своим ключом (аудит 017, 03.10).
  qc.invalidateQueries({ queryKey: ["appointment-ledger"] });
}

export function useIssueInvoice() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // ЯЗЫК ПИШЕТСЯ ВТОРЫМ ШАГОМ И НЕ ВАЛИТ ВЫСТАВЛЕНИЕ. Серверная функция
    // `issue_invoice` его не принимает (добавить параметр — значит создать
    // перегрузку рядом со старой), а язык не деньги: если запись не прошла,
    // счёт остаётся русским, а язык меняют через «Изменить инвойс» (владелец
    // 04.10: на странице выставленного языка нет). Ронять из-за этого выставленный документ было
    // бы куда хуже — но и молчать нельзя (аудит 03.10): вернувшийся документ
    // несёт язык, который реально записан, и экран говорит о расхождении.
    // Вторая попытка — на случай одного моргания сети.
    mutationFn: async ({
      language,
      ...draft
    }: IssueInvoiceDraft & { language?: InvoiceLanguage }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const invoice = await issueInvoice(supabase, tenantId, draft);
      if (language && language !== "ru") {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await setInvoiceLanguage(supabase, invoice.id, language);
            return { ...invoice, language };
          } catch {
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
      return invoice;
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** ПРАВКА ВЫСТАВЛЕННОГО ИНВОЙСА НА МЕСТЕ — тот же номер (владелец 04.10). Язык
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
      if (language && language !== invoice.language) {
        await setInvoiceLanguage(supabase, id, language);
        return { ...invoice, language };
      }
      return invoice;
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** УДАЛЕНИЕ КРЕДИТ-НОТЫ, ПОКА ЕЁ НЕ ОТПРАВИЛИ (владелец 04.10: «отменил
 *  инвойс, а клиент: ладно, плачу»). Последняя в серии, без движения денег;
 *  инвойс возвращается как был (`delete_credit_note`). */
export function useDeleteCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.rpc("delete_credit_note", { p_note_id: noteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/** УДАЛЕНИЕ ПОСЛЕДНЕГО ИНВОЙСА СЕРИИ — номер возвращается (владелец 04.10). */
export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteInvoice(supabase, id),
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/**
 * ЧАСТИЧНАЯ КРЕДИТ-НОТА (владелец 04.10): инвойс остаётся в силе, к оплате —
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
    }) => {
      const { data, error } = await supabase.rpc("issue_partial_credit_note", {
        p_invoice_id: id,
        p_request_id: input.requestId,
        p_amount: input.amount,
        ...(input.reason ? { p_reason: input.reason } : {}),
        p_language: input.language,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Кредит-нота не подтверждена сервером");
      return data;
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

/**
 * Канонный отказ (ТЗ документов 2026-08-09): сервер выпускает кредит-ноту и
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
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

export function useRecordInvoicePayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: RecordInvoicePaymentDraft) =>
      recordInvoicePayment(supabase, invoiceId, draft),
    onSuccess: () => {
      invalidateInvoices(qc);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    meta: { errorHandled: true },
  });
}

