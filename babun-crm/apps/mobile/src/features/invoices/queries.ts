import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInvoice,
  issueInvoice,
  listInvoices,
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

export function useInvoices() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["invoices", tenantId],
    enabled: !!tenantId,
    queryFn: () => listInvoices(supabase, tenantId as string),
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
}

export function useIssueInvoice() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: IssueInvoiceDraft) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      return issueInvoice(supabase, tenantId, draft);
    },
    onSuccess: () => invalidateInvoices(qc),
    meta: { errorHandled: true },
  });
}

export function useEditInvoice(id: string, issuedOn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: EditInvoiceDraft) =>
      updateInvoice(supabase, id, issuedOn, draft),
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
