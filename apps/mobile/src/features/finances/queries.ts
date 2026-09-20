import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  setFinanceCategoryOrder,
  listFinanceCategories,
  updateFinanceCategory,
  type FinanceCategoryPatch,
  type NewFinanceCategory,
} from "@babun/shared/db/repositories/finance-categories";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  financeCategoriesQueryKey,
  ledgerRangeQueryKey as ledgerRangeKey,
  refundTotalsQueryKey,
} from "@/lib/company-query-keys";
import { NEVER_PAUSE } from "./accounts";
import {
  idsFromKey,
  idsKey,
  pickLedgerRows,
  placeholderWithinTenant,
} from "./ledger-select";

/**
 * Журнал ОДНОЙ записи — для истории платежей в блоке оплаты. Отдельный запрос,
 * а не срез месяца: история открывается из записи, которая может быть за любой
 * период, и тянуть ради неё весь журнал тенанта незачем.
 */
export function useAppointmentLedger(appointmentId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["appointment-ledger", tenantId, appointmentId],
    enabled: !!tenantId && !!appointmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("appointment_id", appointmentId as string)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FinanceTransaction[];
    },
  });
}

// Ключ среза журнала (`ledgerRangeKey`) живёт в `lib/company-query-keys.ts`:
// тот же срез берут хук и прогрев другой компании — разъехавшиеся ключи молча
// завели бы две копии одного месяца в кэше.

/**
 * Журнал за период (границы включительно по `occurred_on`), суженный до нужных
 * команд и/или счетов. Тенант ограничивает RLS.
 *
 * КЛЮЧ — ВСЯ КОМПАНИЯ ЗА ПЕРИОД, команды и счета отбирает `select`
 * (`ledger-select.ts`, тем же правилом, что прежние `.in` на сервере). Тап по
 * чипу команды раньше заводил новый ключ: экран шёл в сеть и гас, хотя строки
 * месяца уже лежали в кэше. Теперь тап — это пересчёт на устройстве в том же
 * кадре. Месяц компании — десятки строк, широкое чтение ничего не стоит.
 *
 * Смена ПЕРИОДА по-прежнему держит прошлый срез до прихода нового — экран не
 * мигает спиннером и не показывает нулевые итоги. Показывать его под новой
 * подписью нельзя: пока `isPlaceholderData`, экран обязан гасить цифры. И эта
 * заглушка никогда не берётся из ДРУГОЙ компании (`placeholderWithinTenant`).
 */
export function useTransactions(
  from: string,
  to: string,
  options: {
    brigadeIds?: string[];
    accountIds?: string[];
    /** `false`, пока у зовущего нет периода (пустая неделя, лист дня ещё не
     *  открыт): запрос за пустыми границами никому не нужен. */
    enabled?: boolean;
  } = {},
) {
  const tenantId = useTenantId();
  const teamKey = idsKey(options.brigadeIds);
  const accountKey = idsKey(options.accountIds);
  // Оба зависят от компании и среза. `select` новой ссылкой — пересчёт отбора
  // на тап. Заглушка новой ссылкой — потому что react-query 5, увидев ту же
  // функцию заглушки поверх заглушки, отдаёт прошлый УЖЕ ОТОБРАННЫЙ результат
  // без `select`: тап по команде во время загрузки периода оставил бы строки
  // прошлой команды, а полоса под календарём гашения не знает.
  const { select, placeholderData } = useMemo(
    () => ({
      select: (rows: FinanceTransaction[]) =>
        pickLedgerRows(rows, idsFromKey(teamKey), idsFromKey(accountKey)),
      placeholderData: placeholderWithinTenant<FinanceTransaction[]>(tenantId),
    }),
    [tenantId, teamKey, accountKey],
  );
  return useQuery({
    queryKey: ledgerRangeKey(tenantId, from, to, null, null),
    enabled: !!tenantId && (options.enabled ?? true),
    placeholderData,
    select,
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
    queryKey: refundTotalsQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listRefundTotals(supabase, tenantId as string),
  });
}

export function useFinanceCategories() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: financeCategoriesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: () => listFinanceCategories(supabase, tenantId as string),
  });
}

// Каждая запись в журнал сбрасывает и ["accounts"]: под этим префиксом
// лежат остатки счетов, которые считает тот же журнал (веб-паритет:
// refreshBalances() после каждой мутации). Периодные итоги счетов живут под
// ["transactions"] — их роняет первая же строка.
//
// ["receipts"] здесь не лишний. Сам собой чек больше не рождается (20.09,
// `receipt_on_demand`), но правка и удаление проводки по-прежнему меняют уже
// выписанный документ: возврат его гасит, снятие возврата — оживляет.
// Открытая панель «Чеки» смонтирована и без инвалидации об этом не узнаёт.
function invalidateLedger(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["receipts"] });
  // ["debts"] — остаток долга считается по привязанным операциям, а не
  // колонкой: платёж, не уронивший этот ключ, оставил бы закрытый долг
  // висеть в списке до перезапуска приложения.
  qc.invalidateQueries({ queryKey: ["debts"] });
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
/** ПОРЯДОК СПРАВОЧНИКА КАТЕГОРИЙ — по тенанту (владелец 2026-09-10: «шесть
 *  точек справа для передвижения… везде это добавь»). Пишем всю пачку разом:
 *  перетаскивание меняет позиции всех видимых строк. */
export function useReorderFinanceCategories() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      setFinanceCategoryOrder(supabase, tenantId as string, orderedIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-categories"] }),
    meta: { errorHandled: true },
  });
}

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
