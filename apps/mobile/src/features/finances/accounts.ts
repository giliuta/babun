import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAccounts, listDeletedAccounts } from "@babun/shared/db/repositories/accounts";
import { listAccountBalances } from "@babun/shared/db/repositories/finance-transactions";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  accountBalancesQueryKey,
  accountRowsQueryKey,
  deletedAccountsQueryKey,
} from "@/lib/company-query-keys";
import { useTeams } from "@/features/reference/queries";
import {
  archivedCalendarIds,
  withoutArchivedCalendars,
} from "./archived-calendar-accounts";
import { mergeAccountBalances, type AccountWithBalance } from "./accounts/shared";

// Accounts data layer: the read hooks live here; the merge, cache reset and
// writes live in `./accounts/`.

export type { Account } from "@babun/shared/local/finance/account";
export {
  NEVER_PAUSE,
  mergeAccountBalances,
  type AccountWithBalance,
} from "./accounts/shared";
export {
  useCreateTeamAccounts,
  useCreateTransfer,
  useDeleteAccount,
  useDeleteTransfer,
  useInsertAccount,
  useReopenAccount,
  useReorderAccounts,
  useRestoreAccount,
  useSetAccountHidden,
  useSoftCloseAccount,
  useTrashAccount,
  useUpdateAccount,
} from "./accounts/mutations";

// Карточки счетов живут дольше денег: имя, вид и порядок меняют раз в
// месяц, поэтому список не перезапрашивается на каждом открытии экрана.
const ACCOUNT_ROWS_STALE_MS = 5 * 60_000;

export interface AccountsWithBalances {
  /** undefined, пока не пришли ОБЕ половины: строки счетов и остатки. */
  data: AccountWithBalance[] | undefined;
  isPending: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/**
 * ДЕНЬГИ БЕЗ СЧЁТА — строка, которую сервер считает специально, а экран
 * выбрасывал.
 *
 * `account_balances` возвращает строку с `account_id = null`: это операции, у
 * которых счёта нет вовсе. `useAccountsWithBalances` раскладывает баланс по
 * счетам и такую строку отбрасывает — иначе её некуда положить. Пока её никто
 * не показывал, «Счета» и «Финансы» расходились с реальностью МОЛЧА: сумма на
 * экране меньше настоящей ровно на эти деньги, и сказать об этом было некому.
 *
 * Хук отдаёт ноль, когда всё в порядке (обычный случай), и живое число, когда
 * такие операции есть, — экран показывает его отдельной строкой, а не
 * подмешивает в остаток команды: у этих денег команды нет.
 */
export function useUnassignedMoney(): number {
  const tenantId = useTenantId();
  const balancesQuery = useQuery({
    queryKey: accountBalancesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listAccountBalances(supabase, tenantId as string),
  });
  const orphan = (balancesQuery.data ?? []).find((b) => !b.account_id);
  return orphan?.delta ?? 0;
}

/**
 * Счета и живой остаток по каждому: balance = opening_balance + серверная
 * дельта. Сумму движений считает `account_balances` — раньше клиент ради
 * одного числа вычитывал весь журнал тенанта постранично.
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН. Строки счетов зависят от includeInactive и живут
 * пять минут; остатки от него не зависят и обязаны быть свежими. Пока они
 * лежали в одном ключе, экран счетов и «Финансы» гоняли полный подсчёт
 * ДВАЖДЫ — по разу на каждое значение includeInactive.
 *
 * Ошибку не проглатываем: `account_balances` доступна только владельцу и на
 * чужой роли бросает исключение. `data` остаётся undefined, экран рисует
 * честную ошибку — «€0» вместо остатка было бы враньём про деньги.
 */
export function useAccountsWithBalances(
  options: {
    includeInactive?: boolean;
    /** Счета календарей В АРХИВЕ. По умолчанию их нет нигде: деньги ушедшего
     *  в архив календаря в живых финансах не существуют
     *  (`archived-calendar-accounts.ts`). Просит их только архив. */
    includeArchivedCalendars?: boolean;
    /** Счета из «Удалённых счетов» — только для подписей истории: имя счёта
     *  у прошлой операции не пропадает. Пикеры и списки их не просят. */
    includeDeleted?: boolean;
    /** СКРЫТЫЕ счета (нигде не показываются, только в
     *  счетах). Просят их страница «Счета», лист счёта, лист перевода и
     *  подписи истории; плитка «Счета», оплата, операции и документы — нет.
     *  По умолчанию — как `includeDeleted`: подписям истории нужны все. */
    includeHidden?: boolean;
  } = {},
): AccountsWithBalances {
  const tenantId = useTenantId();
  const includeInactive = options.includeInactive ?? false;
  const includeDeleted = options.includeDeleted ?? false;
  const includeHidden = options.includeHidden ?? includeDeleted;
  const includeArchived = options.includeArchivedCalendars ?? false;
  const rowsQuery = useQuery({
    queryKey: accountRowsQueryKey(tenantId, includeInactive, includeDeleted),
    enabled: !!tenantId,
    staleTime: ACCOUNT_ROWS_STALE_MS,
    queryFn: () =>
      listAccounts(supabase, tenantId as string, { includeInactive, includeDeleted }),
  });
  const balancesQuery = useQuery({
    queryKey: accountBalancesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listAccountBalances(supabase, tenantId as string),
  });
  // Справочник целиком, вместе с архивом: иначе не узнать, чей календарь
  // ушёл. Ключ общий с календарём и лентами — сети обычно нет вовсе.
  const teamsQuery = useTeams({ includeInactive: true });

  const rows = rowsQuery.data;
  const balances = balancesQuery.data;
  const teams = teamsQuery.data;
  // ПОКА СПРАВОЧНИК НЕ ПРИШЁЛ, СЧЕТОВ НЕТ ВОВСЕ — а не «все подряд». Иначе
  // на первом кадре мелькали бы кассы архивного календаря, которых в живых
  // финансах не существует. Упавший справочник экран денег НЕ запирает:
  // лучше показать счета без фильтра архива, чем вечную загрузку.
  const teamsReady = includeArchived || teams !== undefined || teamsQuery.isError;
  const data = useMemo(() => {
    if (!rows || !balances || !teamsReady) return undefined;
    const merged = mergeAccountBalances(rows, balances);
    const shown = includeHidden ? merged : merged.filter((account) => !account.is_hidden);
    return includeArchived
      ? shown
      : withoutArchivedCalendars(shown, archivedCalendarIds(teams ?? []));
  }, [rows, balances, teams, teamsReady, includeArchived, includeHidden]);

  return {
    data,
    isPending:
      rowsQuery.isPending || balancesQuery.isPending || (!teamsReady && teamsQuery.isPending),
    isLoading:
      rowsQuery.isLoading || balancesQuery.isLoading || (!teamsReady && teamsQuery.isLoading),
    error: rowsQuery.error ?? balancesQuery.error,
    refetch: () => Promise.all([rowsQuery.refetch(), balancesQuery.refetch()]),
  };
}

// «УДАЛЁННЫЕ СЧЕТА» (на 30 дней, как клиенты). Ключ под
// ["accounts"]: любая правка счёта перечитывает и эту полку.
export function useDeletedAccounts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: deletedAccountsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listDeletedAccounts(supabase, tenantId as string),
  });
}
