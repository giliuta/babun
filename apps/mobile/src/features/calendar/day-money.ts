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

// ДЕНЬГИ ДНЯ В КАЛЕНДАРЕ — ДЕНЬГИ ЗАПИСИ ЖИВУТ В ДНЕ ЗАПИСИ.
//
// Владелец 2026-10-01: «у нас всё чётко зависит от записи: передвинул запись —
// всё сдвигается и высчитывается именно в этот день, не остаётся там; если
// это добавлено в доход/расход как категория в этот день — тогда фиксируется».
// Поэтому строка журнала относится к дню так:
//   • привязана к записи — к дню ЗАПИСИ, когда бы деньги ни внесли
//     (предоплата 30.09 за запись 1.10 — доход 1.10), и переезжает вместе с
//     записью; запись не в этом дне — строки здесь нет;
//   • без записи — только внесённая кнопкой календаря (`from_calendar`), к
//     дню операции. Операция «Финансов» (реклама €300) в день календаря не
//     попадает (владелец 04.10: «с дохода/расхода календаря переносится в
//     финансы, а с финансов обратно — нет»).
// Так полоса недели, клетка месяца и шторка дня говорят одно и то же, и
// плитка — ровно сумма своего списка (беда 30.09 «открываю доход — операция
// подтягивается неправильно» была в том, что плитка и список считали разными
// правилами). Вкладка «Финансы» — журнал кассы и считает по дню операции.
// Копия записи денег не несёт (`duplicateAppointment` обнуляет оплату).
//
// Зовущий передаёт журнал видимых дней ВМЕСТЕ с операциями своих записей
// (`useAppointmentsLedger`): предоплату могли внести раньше видимых дней.
// Повторы одной строки из двух выборок отсекаются здесь.
//
// Расход дня — расходы журнала тем же правилом плюс материалы записей дня
// (своей проводки у материалов нет — как и на «Финансах»).
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
  /** Записи календаря (можно шире дня — отбор по дате здесь). Все записи
   *  дня, и отменённые: по ним строки журнала находят свой день. */
  appointments: readonly Appointment[];
  /** Журнал: видимые дни и операции своих записей (повторы допустимы). */
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
  const dayTx = moneyOfDay(ymd, input.appointments, input.transactions);

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

/** Строки журнала, которые принадлежат дню: привязанные к записи — по дню
 *  записи, внесённые из календаря — по дню операции; касса «Финансов» дню
 *  календаря чужая. Каждая строка — один раз. */
export function moneyOfDay(
  ymd: string,
  appointments: readonly Pick<Appointment, "id" | "date">[],
  transactions: readonly FinanceTransaction[],
): FinanceTransaction[] {
  const dayRecords = new Set(appointments.filter((a) => a.date === ymd).map((a) => a.id));
  const seen = new Set<string>();
  return transactions.filter((tx) => {
    if (seen.has(tx.id)) return false;
    const mine = tx.appointment_id
      ? dayRecords.has(tx.appointment_id)
      : tx.from_calendar === true && tx.occurred_on === ymd;
    if (mine) seen.add(tx.id);
    return mine;
  });
}

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
