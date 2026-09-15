import type { QueryClient } from "@tanstack/react-query";
import type { AccountBalanceRow } from "@babun/shared/db/repositories/finance-transactions";
import {
  accountBalancesQueryKey,
  accountRowsQueryKey,
} from "@/lib/company-query-keys";
import {
  mergeAccountBalances,
  type Account,
  type AccountWithBalance,
} from "../accounts";

/**
 * Счета с остатками ИЗ КЭША ПОСЛЕ ПЕРЕЧИТЫВАНИЯ, а не из рендера (разбор багов
 * счетов 2026-09-15). `await refetchQueries` возвращается раньше, чем экран
 * перерисуется, поэтому и замыкание, и ref ещё держат остаток до перевода —
 * экран снова предлагал перевести уже переведённые деньги.
 *
 * Читает полный список (`includeInactive`): его держит смонтированным и
 * страница «Счета», и правка счёта. `undefined` — какой-то половины в кэше нет.
 *
 * ОДНО ТЕЛО НА ДВА ВХОДА: «Скрыть» на странице счетов (`use-hide-account`) и
 * «Закрыть счёт» из шторки правки (`account-editor/use-close-flow`) берут его
 * отсюда. Частная копия в снесённой странице настроек счёта ушла вместе с ней.
 */
export async function freshAccounts(
  qc: QueryClient,
  tenantId: string | null,
): Promise<AccountWithBalance[] | undefined> {
  await qc.refetchQueries({ queryKey: ["accounts", tenantId], type: "active" });
  const rows = qc.getQueryData<Account[]>(accountRowsQueryKey(tenantId, true));
  const balances = qc.getQueryData<AccountBalanceRow[]>(
    accountBalancesQueryKey(tenantId),
  );
  return rows && balances ? mergeAccountBalances(rows, balances) : undefined;
}
