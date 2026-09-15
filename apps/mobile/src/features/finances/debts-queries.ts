import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDebt,
  insertDebt,
  listDebtPaidTotals,
  listDebts,
  updateDebt,
  type DebtPatch,
  type NewDebt,
} from "@babun/shared/db/repositories/debts";
import type { Debt } from "@babun/shared/local/finance/debt";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  debtPaidTotalsQueryKey,
  debtsRangeQueryKey,
} from "@/lib/company-query-keys";
import { NEVER_PAUSE } from "./accounts";
import { pickTeamDebts, placeholderWithinTenant } from "./ledger-select";

// Долги живут своими ключами, а не под ["transactions"]: журнал их не
// содержит, и сбрасывать месячный срез из-за заведённого долга незачем.
// Обратное неверно — ПЛАТЁЖ по долгу это операция журнала, поэтому он роняет
// и остатки долгов (см. invalidateDebts у мутаций операций ниже).

/** Долги за период. КЛЮЧ — ВСЯ КОМПАНИЯ, команду отбирает `select`
 *  (`pickTeamDebts`, строго `team_id === teamId`, как `.eq` на сервере): тап
 *  по чипу команды не ходит в сеть и не роняет плитку «Долги» в ноль до
 *  ответа. Смена периода держит прошлые долги гашёными — но только своей
 *  компании (`placeholderWithinTenant`). */
export function useDebts(
  from: string,
  to: string,
  options: { teamId?: string | null; enabled?: boolean } = {},
) {
  const tenantId = useTenantId();
  const teamId = options.teamId ?? null;
  // Та же пара, что у журнала, и по той же причине: заглушка новой ссылкой на
  // смену команды, иначе react-query отдаст прошлый отбор без `select`.
  const { select, placeholderData } = useMemo(
    () => ({
      select: (rows: Debt[]) => pickTeamDebts(rows, teamId),
      placeholderData: placeholderWithinTenant<Debt[]>(tenantId),
    }),
    [tenantId, teamId],
  );
  return useQuery({
    queryKey: debtsRangeQueryKey(tenantId, from, to, null),
    enabled: !!tenantId && (options.enabled ?? true),
    placeholderData,
    select,
    queryFn: () => listDebts(supabase, tenantId as string, from, to),
  });
}

/** Σ платежей по каждому долгу — без окна периода: долг из августа закрывают
 *  в октябре, и оконная сумма показывала бы закрытый долг открытым. */
export function useDebtPaidTotals() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: debtPaidTotalsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listDebtPaidTotals(supabase, tenantId as string),
  });
}

function invalidateDebts(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["debts"] });
}

export function useInsertDebt() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: NewDebt) =>
      insertDebt(supabase, tenantId as string, draft),
    onSuccess: () => invalidateDebts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateDebt() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: DebtPatch }) =>
      updateDebt(supabase, id, patch),
    onSuccess: () => invalidateDebts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** Удаление долга НЕ трогает платежи по нему: `debt_id` объявлен
 *  `on delete set null`. Деньги случились — они остаются на счёте и в
 *  прибыли, просто перестают быть привязаны. Поэтому здесь роняем и журнал:
 *  строка операции теряет связь и перестаёт называть долг. */
export function useDeleteDebt() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteDebt(supabase, id),
    onSuccess: () => {
      invalidateDebts(qc);
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
