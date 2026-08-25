import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInvoice,
  issueInvoice,
  listInvoices,
  setInvoiceLanguage,
  updateInvoice,
  updateInvoiceStatus,
  type EditInvoiceDraft,
  type IssueInvoiceDraft,
} from "@babun/shared/db/repositories/invoices";
import {
  listInvoicePayments,
  recordInvoicePayment,
  refundInvoicePayment,
  type RecordInvoicePaymentDraft,
  type RefundInvoicePaymentDraft,
} from "@babun/shared/db/repositories/invoice-payments";
import type { InvoiceStatus } from "@babun/shared/local/finance/invoice-ledger";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

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
      : ["invoices", tenantId],
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

/**
 * Номер, который получит СЛЕДУЮЩИЙ инвойс.
 *
 * Считает сервер той же функцией, что и выпуск, — предпросмотр не имеет права
 * показывать один номер, а документ получать другой. Это прогноз: пока человек
 * заполняет форму, коллега может выставить свой счёт, и номер сдвинется.
 */
export function useNextInvoiceNumber(year: number) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["invoices", tenantId, "next-number", year],
    enabled: !!tenantId,
    // Свежесть важнее кэша: номер меняется от каждого выставленного счёта.
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc("next_invoice_number", {
        p_tenant_id: tenantId as string,
        p_year: year,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : null;
      return row?.number ?? null;
    },
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
    queryKey: ["invoices", tenantId, "payments"],
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
}

export function useIssueInvoice() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    // ЯЗЫК ПИШЕТСЯ ВТОРЫМ ШАГОМ И НЕ ВАЛИТ ВЫСТАВЛЕНИЕ. Серверная функция
    // `issue_invoice` его не принимает (добавить параметр — значит создать
    // перегрузку рядом со старой), а язык не деньги: если запись не прошла,
    // счёт остаётся русским и переключается на документе одним тапом.
    // Ронять из-за этого выставленный документ было бы куда хуже.
    mutationFn: async ({
      language,
      ...draft
    }: IssueInvoiceDraft & { language?: "ru" | "en" }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const invoice = await issueInvoice(supabase, tenantId, draft);
      if (language && language !== "ru") {
        try {
          await setInvoiceLanguage(supabase, invoice.id, language);
          return { ...invoice, language };
        } catch {
          return invoice;
        }
      }
      return invoice;
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

export function useEditInvoice(id: string, issuedOn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      language,
      ...draft
    }: EditInvoiceDraft & { language?: "ru" | "en" }) => {
      const invoice = await updateInvoice(supabase, id, issuedOn, draft);
      if (language && language !== invoice.language) {
        try {
          await setInvoiceLanguage(supabase, id, language);
          return { ...invoice, language };
        } catch {
          return invoice;
        }
      }
      return invoice;
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

export function useSetInvoiceStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: InvoiceStatus) =>
      updateInvoiceStatus(supabase, id, status),
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
    mutationFn: (draft: RecordInvoicePaymentDraft) =>
      recordInvoicePayment(supabase, invoiceId, draft),
    onSuccess: () => {
      invalidateInvoices(qc);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    meta: { errorHandled: true },
  });
}

export function useRefundInvoicePayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      draft,
    }: {
      paymentId: string;
      draft: RefundInvoicePaymentDraft;
    }) => refundInvoicePayment(supabase, invoiceId, paymentId, draft),
    onSuccess: () => {
      invalidateInvoices(qc);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    meta: { errorHandled: true },
  });
}
