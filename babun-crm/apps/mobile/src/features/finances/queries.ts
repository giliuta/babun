import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteTransaction,
  insertTransaction,
  listRefundTotals,
  listTransactionsForRange,
  updateTransaction,
  type TransactionDraft,
} from "@babun/shared/db/repositories/finance-transactions";
import {
  deleteFinanceCategory,
  insertFinanceCategory,
  listFinanceCategories,
  updateFinanceCategory,
  type FinanceCategoryPatch,
  type NewFinanceCategory,
} from "@babun/shared/db/repositories/finance-categories";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Finance transactions over a date range (inclusive on occurred_on),
// optionally scoped to teams (brigadeIds). RLS scopes to tenant.
export function useTransactions(
  from: string,
  to: string,
  brigadeIds?: string[],
) {
  const tenantId = useTenantId();
  const scope = brigadeIds?.length ? brigadeIds : null;
  return useQuery({
    queryKey: ["transactions", tenantId, from, to, scope],
    enabled: !!tenantId,
    queryFn: () =>
      listTransactionsForRange(
        supabase,
        tenantId as string,
        from,
        to,
        scope ? { brigadeIds: scope } : undefined,
      ),
  });
}

// Σ возвратов по каждому исходному доходу (refund_of_id → сумма) — кап для
// «Создать возврат». Намеренно НЕ оконный запрос (та же логика, что у
// listAccountBalanceDeltas): возврат датируется сегодняшним днём и может
// лежать ВНЕ просматриваемого периода — периодная выборка занижала бы «уже
// возвращено» и пропускала бы возвраты сверх остатка. Слим-проекция
// (refund_of_id, amount) держит пейлоад маленьким; ключ под префиксом
// ["transactions"], поэтому invalidateLedger обновляет и его.
export function useRefundTotals() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "refund-totals"],
    enabled: !!tenantId,
    queryFn: () => listRefundTotals(supabase, tenantId as string),
  });
}

export function useFinanceCategories() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["finance-categories", tenantId],
    enabled: !!tenantId,
    queryFn: () => listFinanceCategories(supabase, tenantId as string),
  });
}

// Every transaction write also invalidates ["accounts"] — the prefix covers
// ["accounts", tenantId, "balances"], whose listAccountBalanceDeltas sums the
// same ledger rows (web parity: refreshBalances() after each ledger mutation).
function invalidateLedger(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["invoices"] });
}

export function useInsertTransaction() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: TransactionDraft) =>
      insertTransaction(supabase, tenantId as string, draft),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TransactionDraft> }) =>
      updateTransaction(supabase, id, patch),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTransaction(supabase, id),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useInsertCategory() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: NewFinanceCategory) =>
      insertFinanceCategory(supabase, tenantId as string, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FinanceCategoryPatch }) =>
      updateFinanceCategory(supabase, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteFinanceCategory(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
