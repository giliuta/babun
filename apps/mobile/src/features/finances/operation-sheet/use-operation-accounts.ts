import { useEffect, useMemo } from "react";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import {
  accountServesTeam,
  isPaymentAccountCompatible,
} from "@babun/shared/local/finance/integrity";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import { useAccountsWithBalances } from "../accounts";
import type { OperationDraft } from "./use-operation-draft";

/** Accounts of the operation form: the pickable list, the team's tiles, the
 *  chosen account and the payment method it implies, plus the effects that
 *  default the account while the person has not picked one by hand. */
export function useOperationAccounts({
  visible,
  isEdit,
  transaction,
  defaultAccountId,
  draft,
}: {
  visible: boolean;
  isEdit: boolean;
  transaction: FinanceTransaction | null | undefined;
  defaultAccountId: string | null | undefined;
  draft: Pick<
    OperationDraft,
    "teamId" | "setTeamId" | "accountId" | "setAccountId" | "accountTouched"
  >;
}) {
  const { teamId, setTeamId, accountId, setAccountId, accountTouched } = draft;
  // Делит кэш счетов с экраном «Финансы» — один запрос на двоих вместо
  // повторного listAccounts.
  //
  // СКРЫТЫЙ СЧЁТ — НЕ ЗАКРЫТЫЙ (аудит финансов 03.10). Список по умолчанию
  // скрытые счета не отдаёт, и операция на счёте, который потом спрятали,
  // объявлялась «на закрытом счёте»: ни сохранить, ни удалить, ни вернуть,
  // хотя сервер её принимает. Берём все и прячем скрытые только из выбора —
  // кроме счёта самой операции и счёта, с карточки которого пришли.
  const accountsQuery = useAccountsWithBalances({ includeHidden: true });
  const txOwnAccountId = transaction?.account_id ?? null;
  const accounts = useMemo(
    () =>
      (accountsQuery.data ?? []).filter(
        (a) => !a.is_hidden || a.id === txOwnAccountId || a.id === defaultAccountId,
      ),
    [accountsQuery.data, txOwnAccountId, defaultAccountId],
  );
  // `account_balances` с уровнями финансов (2026-09-15) отдаёт сотруднику
  // видимые ему остатки, а на отказе по-прежнему БРОСАЕТ. Пустой список счетов
  // из этого делать нельзя: форма сказала бы «у команды нет активного счёта»,
  // то есть соврала бы про устройство компании вместо того, чтобы назвать сбой.
  const accountsFailed =
    accountsQuery.data === undefined && accountsQuery.error !== null;

  // Счета команды операции. Способ оплаты их НЕ фильтрует: он из счёта и
  // выводится — раньше эти два контрола фильтровали друг друга, и человек
  // выбирал одно и то же дважды, сначала «Карта», потом «Карта».
  //
  // Сортировка простая по `position`: делить счета на «командные» и «общие»
  // больше не нужно — у счёта один владелец (владелец 2026-08-15).
  const teamAccounts = useMemo(
    () =>
      teamId
        ? accounts
            .filter((a) => accountServesTeam(a, teamId))
            .sort((a, b) => a.position - b.position)
        : [],
    [accounts, teamId],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const txAccountId = transaction?.account_id ?? null;
  // Счёт операции закрыт: среди живых счетов его нет, а сервер не примет ни
  // правку, ни удаление такой строки. Пока счета не приехали, не решаем —
  // иначе каждая правка на долю секунды объявлялась бы тупиком.
  const txAccountClosed =
    isEdit &&
    !!txAccountId &&
    accountsQuery.data !== undefined &&
    accounts.every((a) => a.id !== txAccountId);

  // ОПЕРАЦИЯ БЕЗ КОМАНДЫ — НЕ ТУПИК: команду наследуем от её счёта, как это
  // делает серверный триггер целостности. Эффект, а не сет при гидрации,
  // потому что счета приезжают асинхронно.
  useEffect(() => {
    if (!visible || !isEdit || teamId) return;
    const home = accounts.find((a) => a.id === txAccountId);
    if (home?.brigade_id) setTeamId(home.brigade_id);
    // Setters from `useState` are stable; listed only because they arrive as
    // arguments here.
  }, [visible, isEdit, teamId, accounts, txAccountId, setTeamId]);

  // СПОСОБ ОПЛАТЫ ВЫВОДИТСЯ ИЗ ВИДА СЧЁТА (биекция способ⇄вид) — отдельного
  // состояния у него нет: оно и рождало формы с ложным «Счёт не подходит»,
  // когда счёт уже выбран, а способ ещё стоял начальным «cash». У существующей
  // операции с её же счётом сохранённый способ сильнее вывода — правка заметки
  // не должна молча переписывать payment_method; тап по чипу счёта
  // (accountTouched) переводит на вывод.
  const payment: PaymentMethod | null =
    transaction &&
    !accountTouched &&
    accountId === transaction.account_id &&
    transaction.payment_method
      ? transaction.payment_method
      : selectedAccount
        ? paymentMethodForAccountKind(selectedAccount.kind)
        : null;
  const accountMismatch =
    !!accountId &&
    (!selectedAccount ||
      !teamId ||
      !accountServesTeam(selectedAccount, teamId) ||
      !isPaymentAccountCompatible(payment, selectedAccount.kind));

  // Дефолт счёта = счёт команды операции (командный раньше общего). Эффект
  // (а не разовый сет при открытии), потому что счета приезжают асинхронно
  // и команда меняется чипами; ручной выбор/сброс (accountTouched) дефолт
  // отключает.
  useEffect(() => {
    if (!visible || accountTouched || isEdit) return;
    if (!teamId || accountId !== null) return;
    const def = teamAccounts[0];
    if (def) setAccountId(def.id);
  }, [visible, accountTouched, isEdit, teamId, accountId, teamAccounts, setAccountId]);

  // ПРИШЛИ С КАРТОЧКИ СЧЁТА — счёт уже назван, спрашивать его второй раз
  // незачем; способ оплаты выведется из вида счёта сам. Эффектом, а не
  // разовым сетом при открытии: список счетов приезжает асинхронно, и вид
  // счёта на момент гидрации бывает ещё неизвестен.
  useEffect(() => {
    if (!visible || isEdit || accountTouched) return;
    if (!defaultAccountId || accountId === defaultAccountId) return;
    const preset = accounts.find((a) => a.id === defaultAccountId);
    if (!preset) return;
    setAccountId(preset.id);
  }, [
    visible,
    isEdit,
    accountTouched,
    defaultAccountId,
    accountId,
    accounts,
    setAccountId,
  ]);

  return {
    accountsQuery,
    accounts,
    accountsFailed,
    teamAccounts,
    selectedAccount,
    txAccountClosed,
    payment,
    accountMismatch,
  };
}
