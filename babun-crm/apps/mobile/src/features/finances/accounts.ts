import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  insertAccount,
  listAccounts,
  softCloseAccount,
  type AccountDraft,
} from "@babun/shared/db/repositories/accounts";
import {
  createTransfer,
  deleteTransfer,
  listAccountBalanceDeltas,
  type TransferDraft,
} from "@babun/shared/db/repositories/finance-transactions";
import type { Account } from "@babun/shared/local/finance/account";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type { Account } from "@babun/shared/local/finance/account";
export type AccountWithBalance = Account & { balance: number };

// Accounts + live balance (opening_balance + signed transaction deltas).
export function useAccountsWithBalances() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["accounts", tenantId, "balances"],
    enabled: !!tenantId,
    queryFn: async (): Promise<AccountWithBalance[]> => {
      const [accounts, deltas] = await Promise.all([
        listAccounts(supabase, tenantId as string),
        listAccountBalanceDeltas(supabase, tenantId as string),
      ]);
      return accounts.map((a) => ({
        ...a,
        balance: a.opening_balance + (deltas.get(a.id) ?? 0),
      }));
    },
  });
}

export function useInsertAccount() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: AccountDraft) =>
      insertAccount(supabase, tenantId as string, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useSoftCloseAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softCloseAccount(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useCreateTransfer() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: TransferDraft) =>
      createTransfer(supabase, tenantId as string, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Removes BOTH legs of a transfer pair by transfer_group_id (web parity:
// the ledger must never carry a half-transfer — see createTransfer's
// invariant in the shared repository).
export function useDeleteTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => deleteTransfer(supabase, groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
