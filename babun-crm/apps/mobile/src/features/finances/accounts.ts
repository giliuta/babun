import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteAccount,
  insertAccount,
  listAccounts,
  reopenAccount,
  setAccountTeams,
  softCloseAccount,
  updateAccount,
  type AccountDraft,
} from "@babun/shared/db/repositories/accounts";
import {
  accountHasLedgerHistory,
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
// includeInactive feeds the «Закрытые счета» mode of the accounts screen;
// the "all"/"active" key segment keeps the two lists separately cached while
// the ["accounts"] prefix invalidation still covers both.
export function useAccountsWithBalances(
  options: { includeInactive?: boolean } = {},
) {
  const tenantId = useTenantId();
  const includeInactive = options.includeInactive ?? false;
  return useQuery({
    queryKey: [
      "accounts",
      tenantId,
      "balances",
      includeInactive ? "all" : "active",
    ],
    enabled: !!tenantId,
    queryFn: async (): Promise<AccountWithBalance[]> => {
      const [accounts, deltas] = await Promise.all([
        listAccounts(supabase, tenantId as string, { includeInactive }),
        listAccountBalanceDeltas(supabase, tenantId as string),
      ]);
      return accounts.map((a) => ({
        ...a,
        balance: a.opening_balance + (deltas.get(a.id) ?? 0),
      }));
    },
  });
}

// Membership of a company account («какие команды подключены»). Diff-based
// replace; the rows themselves are immutable on the server.
export function useSetAccountTeams() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, teamIds }: { accountId: string; teamIds: string[] }) =>
      setAccountTeams(supabase, tenantId as string, accountId, teamIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useReopenAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reopenAccount(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Жёсткое удаление счёта без единой операции (опечатка сразу после
// создания); сервер отклонит счёт с историей.
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAccount(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Зеркало серверного guard_account_financial_history: настройки счёта
// глушат правку вида/старта/команды заранее, а не ошибкой после сохранения.
export function useAccountHasHistory(accountId: string | null) {
  return useQuery({
    queryKey: ["accounts", "has-history", accountId],
    enabled: !!accountId,
    queryFn: () => accountHasLedgerHistory(supabase, accountId as string),
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

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AccountDraft> }) =>
      updateAccount(supabase, id, patch),
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
