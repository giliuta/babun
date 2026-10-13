import { useRefundTotals } from "../queries";
import type { BusinessClock } from "./use-business-clock";
import type { useHomeLedger } from "./use-home-ledger";
import type { HomeReferences } from "./use-home-references";

/** Loading / stale / error gate of the whole screen, its «Повторить», and
 *  the refund totals that live outside the gate. */
export function useHomeGate(
  refs: HomeReferences,
  ledger: Pick<ReturnType<typeof useHomeLedger>, "transactionsQuery" | "debtsQuery" | "debtPaidQuery">,
  calendarSettingsQuery: BusinessClock["calendarSettingsQuery"],
) {
  const { transactionsQuery, debtsQuery, debtPaidQuery } = ledger;
  const {
    categoriesQuery,
    teamsQuery,
    servicesQuery,
    appointmentsQuery,
    clientsQuery,
    invoicesQuery,
    invoicePaymentsQuery,
    accountsQuery,
  } = refs;
  // Σ refunds already issued against each income — caps further refunds.
  // NOT computed from the period-windowed txs: a refund is dated TODAY and
  // can land outside the viewed period (e.g. refunding a June income while
  // browsing «Прошлый месяц» on July 2) — the windowed sum would reset to 0
  // and let repeat refunds silently overdraw the ledger.
  const refundTotalsQuery = useRefundTotals();
  const refundTotals = refundTotalsQuery.data;
  // Σ ВОЗВРАТОВ — ВНЕ ПОЛНОГО ГЕЙТА (аудит финансов 2026-09-24). Витрина
  // операции и лист правки уже консервативны без неё: `alreadyRefunded` /
  // `refundedTotal` ниже подставляют Infinity, пока `refundTotals`
  // не приехал, — «Создать возврат» гасится сам, а не ждёт всей компании.
  // Держать эту цифру в общем гейте значило прятать ВЕСЬ экран (журнал,
  // счета, долги — всё готово) ради одного запроса, который нужен только
  // форме возврата; тот же трюк уже применили к «Долгам платежей» нельзя —
  // там цена ошибки другая (закрытый долг мигнул бы открытым), а тут кап
  // просто не предлагается, пока не известен.
  const refundTotalsLoading = refundTotalsQuery.isPending;
  const refundTotalsFailed =
    refundTotalsQuery.data === undefined && refundTotalsQuery.error != null;

  // Every number on this screen combines several independent sources. Do not
  // render plausible-looking zeroes when one of them is still loading or has
  // failed: a user can otherwise make a financial decision from an
  // incomplete ledger without any visible warning.
  // isPending, не isLoading: офлайн-paused запрос (isFetching=false) иначе
  // проваливался под гейт и рисовал нулевой P&L как настоящие данные.
  // Журнал и долги — вне полного гейта: смена периода не должна прятать весь
  // экран (хуки держат прошлые данные своей компании до прихода новых); первый
  // заход и холодная компания ловятся `isPending` без данных. Суммы платежей
  // по долгам окна не имеют и заглушки не держат — ждём их целиком: без них
  // закрытый долг на миг выглядел бы открытым.
  const loading =
    (transactionsQuery.isPending && transactionsQuery.data === undefined) ||
    (debtsQuery.isPending && debtsQuery.data === undefined) ||
    debtPaidQuery.isPending ||
    categoriesQuery.isPending ||
    teamsQuery.isPending ||
    servicesQuery.isPending ||
    appointmentsQuery.isPending ||
    clientsQuery.isPending ||
    invoicesQuery.isPending ||
    invoicePaymentsQuery.isPending ||
    accountsQuery.isPending ||
    calendarSettingsQuery.isPending;
  // Смена периода: прошлый срез ещё на экране, подпись уже новая. Такие цифры
  // гасятся (§8) — подменять деньги молча нельзя, по ним принимают решения.
  // Смена КОМАНДЫ сюда больше не попадает: журнал и долги читаются ключом
  // компании, команду отбирает `select` в том же кадре. Долги гасятся вместе с
  // журналом: плитка «Долги» складывает обоих.
  const stale = transactionsQuery.isPlaceholderData || debtsQuery.isPlaceholderData;
  const loadError =
    (transactionsQuery.data === undefined ? transactionsQuery.error : null) ||
    (debtsQuery.data === undefined ? debtsQuery.error : null) ||
    (debtPaidQuery.data === undefined ? debtPaidQuery.error : null) ||
    (categoriesQuery.data === undefined ? categoriesQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (servicesQuery.data === undefined ? servicesQuery.error : null) ||
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (invoicesQuery.data === undefined ? invoicesQuery.error : null) ||
    (invoicePaymentsQuery.data === undefined ? invoicePaymentsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined ? calendarSettingsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      transactionsQuery.refetch(),
      debtsQuery.refetch(),
      debtPaidQuery.refetch(),
      categoriesQuery.refetch(),
      teamsQuery.refetch(),
      servicesQuery.refetch(),
      appointmentsQuery.refetch(),
      clientsQuery.refetch(),
      invoicesQuery.refetch(),
      invoicePaymentsQuery.refetch(),
      accountsQuery.refetch(),
      refundTotalsQuery.refetch(),
      calendarSettingsQuery.refetch(),
    ]);
  return {
    refundTotals,
    refundTotalsLoading,
    refundTotalsFailed,
    loading,
    stale,
    loadError,
    refreshAll,
  };
}
