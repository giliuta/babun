// Итоги счетов за период — чтение серверного `account_period_totals`.
//
// ЕДИНСТВЕННОЕ ПРАВИЛО ЭТОГО ФАЙЛА: колонки приходят УЖЕ СО ЗНАКОМ
// (income ≥ 0, expense ≤ 0, refund ≤ 0, transfer_in ≥ 0, transfer_out ≤ 0),
// поэтому клиент их только СКЛАДЫВАЕТ. Любой минус перед expense или refund
// вычитает второй раз и завышает картину — на живом тенанте запрещённая
// формула «доход − расход − возврат» давала €280 там, где на счёте €180.
// Контракт закреплён тестом account-period.test.ts.

import { moneySign } from "@babun/shared/common/utils/money";
import type { AccountPeriodTotals } from "@babun/shared/db/repositories/finance-transactions";

/** Серверные итоги одного счёта за период — без ключа счёта. */
export type AccountPeriodSummary = Omit<AccountPeriodTotals, "account_id">;

/** Остаток на конец периода: начало плюс все движения подряд. */
export function accountPeriodClosing(t: AccountPeriodSummary): number {
  return (
    t.opening_before
    + t.income
    + t.expense
    + t.refund
    + t.transfer_in
    + t.transfer_out
  );
}

/** Строка сверяемой колонки «ЗА ПЕРИОД» карточки счёта. */
export interface AccountPeriodRow {
  key: "opening" | "income" | "refund" | "expense" | "transfers" | "closing";
  label: string;
  value: number;
  /** Цвет несёт ЗНАК и смысл: переводы нейтральны при любом знаке — это свои
   *  же деньги на другом счёте, а не доход и не расход. */
  tone: "ink" | "success" | "danger";
  /** Движение печатается со знаком («+€690»), остаток — без («€500»). */
  signed: boolean;
  /** Итог колонки — крупнее остальных строк. */
  strong?: boolean;
}

function movementTone(value: number): AccountPeriodRow["tone"] {
  const sign = moneySign(value);
  return sign > 0 ? "success" : sign < 0 ? "danger" : "ink";
}

/**
 * СВЕРЯЕМАЯ КОЛОНКА ЗА ПЕРИОД (ТЗ §6.5) — для любого счёта, а не только для
 * счёта компании.
 *
 * Строки складываются сверху вниз и обязаны дать «Остаток на конец»: значения
 * приходят с сервера УЖЕ СО ЗНАКОМ, поэтому здесь нет ни одного минуса.
 *
 * У ВОЗВРАТА СВОЯ СТРОКА. Без неё колонка не сходится ровно на сумму
 * возвратов (живой счёт «Карта» за июнь: 0 + 690 − 440 − 60 + 150 = €340, а
 * пятистрочная колонка напечатала бы €400 рядом с героем «€340»). Зашить
 * возврат в «Приход» тоже нельзя — «Приход +€630» соврал бы о выручке.
 * Пустая строка возвратов не рисуется: у большинства счетов их не бывает.
 */
export function accountPeriodRows(
  t: AccountPeriodSummary,
): AccountPeriodRow[] {
  const transfers = t.transfer_in + t.transfer_out;
  const rows: AccountPeriodRow[] = [
    {
      key: "opening",
      label: "Остаток на начало",
      value: t.opening_before,
      tone: "ink",
      signed: false,
    },
    {
      key: "income",
      label: "Приход",
      value: t.income,
      tone: movementTone(t.income),
      signed: true,
    },
  ];
  if (moneySign(t.refund) !== 0) {
    rows.push({
      key: "refund",
      label: "Возвраты",
      value: t.refund,
      tone: "danger",
      signed: true,
    });
  }
  rows.push(
    {
      key: "expense",
      label: "Расход",
      value: t.expense,
      tone: movementTone(t.expense),
      signed: true,
    },
    {
      key: "transfers",
      label: "Переводы",
      value: transfers,
      tone: "ink",
      signed: true,
    },
    {
      key: "closing",
      label: "Остаток на конец",
      value: accountPeriodClosing(t),
      tone: "ink",
      signed: false,
      strong: true,
    },
  );
  return rows;
}

// Суммирования итогов по нескольким счетам здесь больше нет: после решения
// «итог — только по выбранному счёту» (1e802ddc) его не звал ни один экран.
// Если сумма «по всем командам» вернётся — складывать покомпонентно, без
// единого минуса, как и всё в этом файле.
