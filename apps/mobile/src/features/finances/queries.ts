import {
  keepPreviousData,
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
  setFinanceCategoryHidden,
  listFinanceCategories,
  updateFinanceCategory,
  type FinanceCategoryPatch,
  type NewFinanceCategory,
} from "@babun/shared/db/repositories/finance-categories";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { NEVER_PAUSE } from "./accounts";

/** Ключ среза журнала. Собирается ОДНОЙ функцией, потому что тот же срез
 *  берут и хук, и разовая дозагрузка выписки — разъехавшиеся ключи молча
 *  завели бы две копии одного месяца в кэше. */
function ledgerRangeKey(
  tenantId: string | null | undefined,
  from: string,
  to: string,
  teamScope: string[] | null,
  accountScope: string[] | null,
) {
  return ["transactions", tenantId, from, to, teamScope, accountScope];
}

/**
 * Журнал за период (границы включительно по `occurred_on`), сужаемый до нужных
 * команд и/или счетов. Тенант ограничивает RLS.
 *
 * `accountIds` — не оптимизация ради оптимизации: карточка обычной кассы
 * показывает операции ОДНОГО счёта, а тянула месячный срез всего тенанта.
 * Полный срез остаётся там, где он действительно нужен, — у счёта компании,
 * где инкассацию атрибуцирует вторая нога перевода, лежащая на чужом счёте.
 */
export function useTransactions(
  from: string,
  to: string,
  options: {
    brigadeIds?: string[];
    accountIds?: string[];
    /** `false`, пока экран не знает, какой срез ему нужен: запрос не должен
     *  уехать за полным журналом только потому, что строка счёта ещё не
     *  приехала. */
    enabled?: boolean;
  } = {},
) {
  const tenantId = useTenantId();
  const teamScope = options.brigadeIds?.length ? options.brigadeIds : null;
  const accountScope = options.accountIds?.length ? options.accountIds : null;
  return useQuery({
    queryKey: ledgerRangeKey(tenantId, from, to, teamScope, accountScope),
    enabled: !!tenantId && (options.enabled ?? true),
    // Смена периода/скоупа держит прошлый срез до прихода нового — экран не
    // мигает полноэкранным спиннером и не показывает нулевые итоги. Показывать
    // его под НОВОЙ подписью нельзя: пока `isPlaceholderData`, экран обязан
    // гасить цифры, а не выдавать чужой месяц за свой.
    placeholderData: keepPreviousData,
    queryFn: () =>
      listTransactionsForRange(supabase, tenantId as string, from, to, {
        ...(teamScope ? { brigadeIds: teamScope } : {}),
        ...(accountScope ? { accountIds: accountScope } : {}),
      }),
  });
}

/**
 * Разовая дозагрузка ПОЛНОГО среза периода — по нажатию, а не подпиской.
 *
 * Нужна ровно одному месту: выписке по счёту. Её колонке «Корреспондент» нужна
 * ВТОРАЯ нога перевода, а она лежит на чужом счёте и в суженный срез карточки
 * не попадает. Держать ради этой колонки постоянную подписку на журнал всего
 * тенанта — плохой размен: выписку просят раз в месяц, а карточку открывают
 * двадцать раз в день.
 */
export function useFetchLedgerRange() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return (from: string, to: string) =>
    qc.fetchQuery({
      queryKey: ledgerRangeKey(tenantId, from, to, null, null),
      queryFn: () => listTransactionsForRange(supabase, tenantId as string, from, to),
    });
}

// Σ возвратов по каждому исходному доходу (refund_of_id → сумма) — кап для
// «Создать возврат». Намеренно НЕ оконный запрос (та же логика, что у
// остатков счетов): возврат датируется сегодняшним днём и может
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

// Каждая запись в журнал сбрасывает и ["accounts"]: под этим префиксом
// лежат остатки счетов, которые считает тот же журнал (веб-паритет:
// refreshBalances() после каждой мутации). Периодные итоги счетов живут под
// ["transactions"] — их роняет первая же строка.
//
// ["receipts"] здесь не лишний: чеки выписывает СЕРВЕР триггером в момент
// проводки дохода, правит при редактировании и оживляет при удалении
// возврата. Открытая панель «Чеки» смонтирована и без инвалидации не
// узнаёт о документе, который её же empty state обещает «выписывается сам».
function invalidateLedger(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["receipts"] });
}

export function useInsertTransaction() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: TransactionDraft) =>
      insertTransaction(supabase, tenantId as string, draft),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TransactionDraft> }) =>
      updateTransaction(supabase, id, patch),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteTransaction(supabase, id),
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Справочники — тоже онлайн-only на запись: без NEVER_PAUSE офлайн-вызов
// встаёт в paused, mutateAsync не резолвится, и кнопка сохранения категории
// крутится вечно без ошибки (см. комментарий у NEVER_PAUSE в accounts.ts).
export function useInsertCategory() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: NewFinanceCategory) =>
      insertFinanceCategory(supabase, tenantId as string, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: FinanceCategoryPatch }) =>
      updateFinanceCategory(supabase, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** Скрыть/вернуть категорию в списке этого тенанта. Стандартные строки
 *  нельзя ни переименовать, ни удалить (они общие на весь продукт) — зато
 *  можно убрать из своего списка. */
export function useSetCategoryHidden() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      setFinanceCategoryHidden(supabase, tenantId as string, id, hidden),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteFinanceCategory(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
