import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { sumExtras } from "@babun/shared/local/day-extras";
import type { MaterialCatalogService } from "@babun/shared/local/finance/appointment-calc";
import { isPlannedRecord } from "@babun/shared/local/finance/day-summary";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { incomeDeals } from "@/features/finances/income-deals";
import { materialExpenseRows } from "@/features/finances/material-expenses";
import { dayDebtRecords, isPastRecord } from "./day-ledger";

// ДЕНЬГИ ДНЯ В КАЛЕНДАРЕ — ОДНО ПРАВИЛО С «ФИНАНСАМИ» (владелец 2026-09-30:
// «открываю доход — операция подтягивается неправильно»).
//
// Доход дня — деньги, которые ПРИШЛИ В ЭТОТ ДЕНЬ: доходы и возвраты леджера
// по дате операции, ровно как плитка «Доход» на вкладке «Финансы». Раньше
// календарь брал оплаты записей ЭТОГО ДНЯ: предоплата, внесённая сегодня за
// завтрашнюю запись, стояла доходом завтра, сегодня был ноль, а список под
// плиткой «Доход» — пуст (строка леджера датирована сегодня). Теперь плитка —
// ровно сумма своего списка, и полоса недели, клетка месяца и шторка дня
// говорят одно и то же.
//
// Расход дня — расходы леджера по дате плюс материалы записей дня (своей
// проводки у материалов нет — как и на «Финансах»).
//
// Личное событие («Событие», обед, перерыв) — не деньги: в долг, план и
// «Ожидается» оно не входит и в списке дня не стоит «€0 оплачено».
//
// Долг — время записи прошло, а остаток не получен; «Ожидается» — остаток
// ещё не прошедших записей (предоплата уже пришла и ожидаемой не считается).

/** Запись, у которой бывают деньги. Событие — нет. */
export function isMoneyRecord(a: Pick<Appointment, "kind">): boolean {
  return a.kind === "work";
}

export interface DayMoney {
  /** Пришло за день: доходы минус возвраты (+ старые ручные доходы дня). */
  income: number;
  /** Ушло за день: расходы леджера + материалы записей (+ старые ручные). */
  expense: number;
  profit: number;
  /** Остаток по прошедшим неоплаченным записям. */
  debt: number;
  /** Остаток по записям, время которых ещё не прошло. */
  planned: number;
  /** Строки плитки «Доход» — сумма их равна `income` без старых ручных. */
  incomeRows: FinanceTransaction[];
  /** Строки плитки «Расход»: расходы леджера и материалы записей. */
  expenseRows: FinanceTransaction[];
  debtRecords: Appointment[];
  plannedRecords: Appointment[];
  /** Записи дня с деньгами (без событий и отменённых) — план дня. */
  records: Appointment[];
}

export function dayMoney(input: {
  ymd: string;
  /** Записи календаря (можно шире дня — отбор по дате здесь). */
  appointments: readonly Appointment[];
  /** Леджер (можно шире дня — отбор по дате операции здесь). */
  transactions: readonly FinanceTransaction[];
  services: readonly MaterialCatalogService[];
  /** Команда полосы: материалы — записей этой команды (null — все). */
  teamId: string | null;
  /** Старые «ручные операции дня» (day_extras) — только показ. */
  extras?: readonly DayExtra[];
  businessToday: string;
  nowHm: string;
}): DayMoney {
  const { ymd } = input;
  const records = input.appointments.filter(
    (a) => a.date === ymd && isMoneyRecord(a) && a.status !== "cancelled",
  );
  const dayTx = input.transactions.filter((tx) => tx.occurred_on === ymd);

  const incomeRows = incomeDeals(dayTx);
  const materialRows = materialExpenseRows(records, input.services, {
    from: ymd,
    to: ymd,
    teamId: input.teamId,
  });
  const expenseRows = [...dayTx.filter((tx) => tx.type === "expense"), ...materialRows];

  const extras = sumExtras([...(input.extras ?? [])]);
  const income = cents(incomeRows.reduce((sum, tx) => sum + signedAmount(tx), 0) + extras.income);
  const expense = cents(expenseRows.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) + extras.expense);

  const debtRecords = dayDebtRecords(records, input.businessToday, input.nowHm);
  const plannedRecords = records
    .filter(
      (a) =>
        isPlannedRecord(a) &&
        getDebtAmount(a) > 0 &&
        !isPastRecord(a, input.businessToday, input.nowHm),
    )
    .sort((a, b) => a.time_start.localeCompare(b.time_start));

  return {
    income,
    expense,
    profit: cents(income - expense),
    debt: cents(debtRecords.reduce((sum, a) => sum + getDebtAmount(a), 0)),
    planned: cents(plannedRecords.reduce((sum, a) => sum + getDebtAmount(a), 0)),
    incomeRows,
    expenseRows,
    debtRecords,
    plannedRecords,
    records,
  };
}

const cents = (v: number): number => Math.round(v * 100) / 100;

// ─── ПО СЧЕТАМ ─────────────────────────────────────────────────────────
// Владелец 2026-09-30: «открываю доход — сколько зашло на каждый счёт: за
// сегодня на наличку, на карту и так далее, на те счета, которые я создал».

export interface AccountMoney {
  /** null — строки без счёта (старые операции). */
  accountId: string | null;
  amount: number;
  /** Сколько операций легло на этот счёт. */
  count: number;
}

/**
 * Суммы строк плитки по счетам. Порядок — порядок счетов на странице «Счета»
 * (`accountOrder`), дальше счета, которых в нём нет (закрытые, чужие), и
 * последней — корзина «без счёта». Счёт из `accountOrder` стоит и с нулём:
 * «на карту сегодня ничего» — тоже ответ. Материалы записей (своего счёта у
 * них нет) в разбивку не входят: с кассы они не уходили.
 */
export function moneyByAccount(
  rows: readonly FinanceTransaction[],
  accountOrder: readonly string[],
): AccountMoney[] {
  const sums = new Map<string | null, AccountMoney>();
  for (const id of accountOrder) sums.set(id, { accountId: id, amount: 0, count: 0 });
  for (const tx of rows) {
    if (tx.source === "auto" && tx.id.startsWith("material:")) continue;
    const key = tx.account_id ?? null;
    const entry = sums.get(key) ?? { accountId: key, amount: 0, count: 0 };
    entry.amount = cents(
      entry.amount + (tx.type === "expense" ? Math.abs(tx.amount) : signedAmount(tx)),
    );
    entry.count += 1;
    sums.set(key, entry);
  }
  const ordered = accountOrder.map((id) => sums.get(id)!);
  const rest = [...sums.values()].filter(
    (e) => e.accountId !== null && !accountOrder.includes(e.accountId),
  );
  const none = sums.get(null);
  return [...ordered, ...rest, ...(none ? [none] : [])];
}
