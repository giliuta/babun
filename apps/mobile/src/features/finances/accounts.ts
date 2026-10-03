import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  deleteAccount,
  insertAccount,
  listAccounts,
  listDeletedAccounts,
  reopenAccount,
  restoreAccount,
  softCloseAccount,
  trashAccount,
  updateAccount,
  type AccountDraft,
} from "@babun/shared/db/repositories/accounts";
import {
  createTransfer,
  deleteTransfer,
  listAccountBalances,
  type AccountBalanceRow,
  type TransferDraft,
} from "@babun/shared/db/repositories/finance-transactions";
import type {
  Account,
  AccountScope,
} from "@babun/shared/local/finance/account";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  accountBalancesQueryKey,
  accountRowsQueryKey,
  deletedAccountsQueryKey,
} from "@/lib/company-query-keys";
import { useTeams } from "@/features/reference/queries";
import {
  TEAM_ACCOUNT_SEEDS,
  planAccountSeeds,
  type AccountSeed,
} from "./account-seeds";
import {
  archivedCalendarIds,
  withoutArchivedCalendars,
} from "./archived-calendar-accounts";

export type { Account } from "@babun/shared/local/finance/account";
export type AccountWithBalance = Account & {
  /** opening_balance + серверная дельта журнала. */
  balance: number;
  /** Была ли по счёту хоть одна операция. */
  has_history: boolean;
  /** Даты для подписей строки счёта (YYYY-MM-DD, null — движений не было). */
  last_outflow_on: string | null;
  last_tx_on: string | null;
  first_tx_on: string | null;
};

// Любая правка счёта задевает ДВА кэша. Второй — ["payment-accounts"]: набор
// касс для приёма денег, он живёт 5 минут и своей инвалидации не имел, поэтому
// закрытый счёт ещё пять минут предлагался в записи, инвойсе и шаблоне.
function invalidateAccounts(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["payment-accounts"] });
}

// НИ ОДНА ЗАПИСЬ НЕ ВСТАЁТ В ПАУЗУ (ТЗ §8). По умолчанию react-query держит
// мутацию без сети в `paused`: `mutateAsync` не резолвится, кнопка крутится
// вечно, ошибки нет, а свёрнутое приложение уносит намерение молча — человек
// так и не узнаёт, что стало с деньгами. Финансы онлайн-only на запись,
// поэтому запрос обязан честно упасть сетевой ошибкой: экран называет причину
// и сохраняет набранное, а повтор попадает в серверный дедуп по `request_id`.
//
// Стоит на КАЖДОЙ денежной записи продукта, а не только на переводе: закрытие
// счёта, перестановка строк и сохранение операции без сети зависали ровно так
// же.
export const NEVER_PAUSE = { networkMode: "always" } as const;

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
 * выбрасывал (аудит счетов 2026-09-10).
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
     *  в архив календаря в живых финансах не существуют (владелец
     *  2026-09-21, `archived-calendar-accounts.ts`). Просит их только архив. */
    includeArchivedCalendars?: boolean;
    /** Счета из «Удалённых счетов» — только для подписей истории: имя счёта
     *  у прошлой операции не пропадает. Пикеры и списки их не просят. */
    includeDeleted?: boolean;
  } = {},
): AccountsWithBalances {
  const tenantId = useTenantId();
  const includeInactive = options.includeInactive ?? false;
  const includeDeleted = options.includeDeleted ?? false;
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
    return includeArchived
      ? merged
      : withoutArchivedCalendars(merged, archivedCalendarIds(teams ?? []));
  }, [rows, balances, teams, teamsReady, includeArchived]);

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

/** Строки счетов + серверные остатки → счета с живым остатком. Одна склейка на
 *  хук и на чтение из кэша после перевода (закрытие счёта). */
export function mergeAccountBalances(
  rows: readonly Account[],
  balances: readonly AccountBalanceRow[],
): AccountWithBalance[] {
  const byAccount = new Map(
    balances.filter((b) => b.account_id).map((b) => [b.account_id, b]),
  );
  return rows.map((a): AccountWithBalance => {
    const b = byAccount.get(a.id);
    return {
      ...a,
      balance: a.opening_balance + (b?.delta ?? 0),
      has_history: b?.has_history ?? false,
      last_outflow_on: b?.last_outflow_on ?? null,
      last_tx_on: b?.last_tx_on ?? null,
      first_tx_on: b?.first_tx_on ?? null,
    };
  });
}

export function useReopenAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => reopenAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// «УДАЛЁННЫЕ СЧЕТА» (владелец 03.10: «на 30 дней, как клиенты»). Ключ под
// ["accounts"]: любая правка счёта перечитывает и эту полку.
export function useDeletedAccounts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: deletedAccountsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listDeletedAccounts(supabase, tenantId as string),
  });
}

/** «Удалить» — счёт уходит в «Удалённые счета»; правила держит сервер. */
export function useTrashAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => trashAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Вернуть» из «Удалённых счетов» — обычный открытый счёт. */
export function useRestoreAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => restoreAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Жёсткое удаление счёта без единой операции (опечатка сразу после
// создания); сервер отклонит счёт с историей.
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useInsertAccount() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: AccountDraft) =>
      insertAccount(supabase, tenantId as string, draft),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AccountDraft> }) =>
      updateAccount(supabase, id, patch),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/**
 * Новый порядок строк группы (одна команда либо счета компании): пишем
 * позиции 0, 1, 2… по списку id.
 *
 * Параллельно, а не по очереди: уникального индекса на (tenant_id,
 * brigade_id, position) в базе НЕТ и заведён он не будет — миграция
 * 20260810170200 объясняет, почему (перестановка двух строк неизбежно
 * проходит через промежуточный дубль позиции). Значит, гонки за одно
 * значение здесь не существует, и семь строк не должны ехать семью
 * последовательными запросами.
 *
 * Порядок — это и ОПЛАТА (владелец 2026-09-29): выше в списке — первым среди
 * плиток оплаты и первым среди счетов своего вида, когда оплату записали
 * способом без выбора счёта.
 */
export function useReorderAccounts() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (ids: readonly string[]) =>
      Promise.all(
        ids.map((id, index) =>
          updateAccount(supabase, id, { position: index }),
        ),
      ),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/**
 * Автосоздание счетов (ТЗ §5.1). Тумблера нет: команда без счёта не может
 * принять деньги вообще. Единственный живой вызов — `useCreateTeamAccounts`
 * с `TEAM_ACCOUNT_SEEDS` («Наличные» и «Карта» новой команде); сида «счетов
 * компании» больше нет — счёт принадлежит ровно одной команде (владелец
 * 2026-08-15), и заводить общий счёт стало некому.
 *
 * Каждый счёт — один `insertAccount`, никаких привязок вторым запросом.
 * Обрыв (потеря сети между вставками, убитое приложение) оставляет часть
 * счетов незаведённой — и лечится повтором: план считает `planAccountSeeds`,
 * который пропускает уже существующие имена, включая закрытые.
 */
function useSeedAccounts(
  seeds: readonly AccountSeed[],
  scope: AccountScope,
) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (brigadeId: string | null): Promise<Account[]> => {
      const tenant = tenantId as string;
      // Полный список, включая закрытые: имя занято и закрытым счётом.
      const existing = await listAccounts(supabase, tenant, {
        includeInactive: true,
      });
      const plan = planAccountSeeds({ seeds, existing, brigadeId });
      const created: Account[] = [];
      // Последовательно: у второй вставки нет причины гоняться с первой, а
      // при отказе понятно, что успело завестись.
      for (const item of plan) {
        created.push(
          await insertAccount(supabase, tenant, {
            scope,
            brigade_id: brigadeId,
            name: item.name,
            kind: item.kind,
            position: item.position,
          }),
        );
      }
      return created;
    },
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites toast themselves
  });
}

/** «Наличные» и «Карта» новой команде. Аргумент мутации — id команды. */
export function useCreateTeamAccounts() {
  return useSeedAccounts(TEAM_ACCOUNT_SEEDS, "team");
}

/** Закрытие счёта. «Основного» больше нет (владелец 2026-09-29), и
 *  передавать при закрытии нечего. */
export function useSoftCloseAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async ({ id }: { id: string }) => {
      await softCloseAccount(supabase, id);
    },
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useCreateTransfer() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
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
    // «Отменить» в тосте — тоже запись: без сети она обязана сказать «не
    // получилось», а не тихо ждать связи, пока тост уже уехал.
    ...NEVER_PAUSE,
    mutationFn: (groupId: string) => deleteTransfer(supabase, groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
