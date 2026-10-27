// Pure money arithmetic of the «Финансы» home tiles: period totals, materials
// and the «Прибыль» comparison with the previous period.

import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { signedAmount, type FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Service } from "@/features/services/queries";
import { isPastRecord } from "@/features/finances/day-ledger";
import { materialsByService } from "../breakdown";
import type { FinancePageAccess } from "../finance-page-access";
import {
  readableTransactions,
  type DebtTeams,
  type FinanceReadRules,
} from "../finance-read-rules";
import { periodMaterials, periodMoney, type PeriodMoney } from "../profit-compare";
import { inTeamScope, teamlessLedgerRows, withTeamlessRows } from "../team-scope";
import { forClient } from "./home-scope";

type RecordMoneyAccess = Pick<FinancePageAccess, "recordMoney">;
type Range = { from: string; to: string };

export interface MaterialSummary {
  amount: number;
  appointmentCount: number;
  byService: Map<string, number>;
}

export function materialSummaryFor(
  access: RecordMoneyAccess,
  scopedAppointments: readonly Appointment[],
  services: readonly Service[],
  period: Range,
  scope: string | null,
): MaterialSummary {
  // Материалы записей — деньги из записей: сотруднику записи приходят с
  // нулями, и такая цифра была бы выдумкой (`access.recordMoney`).
  if (!access.recordMoney) {
    return { amount: 0, appointmentCount: 0, byService: new Map<string, number>() };
  }
  const { amount, appointmentCount, costly } = periodMaterials(
    scopedAppointments,
    services,
    { from: period.from, to: period.to, scope },
    true,
  );
  // Те же записи — по услугам: «Прибыль» подписывает услугу её материалами.
  return { amount, appointmentCount, byService: materialsByService(costly, services) };
}

export interface HomeTotals {
  income: number;
  expense: number;
  profit: number;
  debt: number;
}

export interface HomeTotalsInput {
  access: RecordMoneyAccess;
  scopedTransactions: readonly FinanceTransaction[];
  scopedAppointments: readonly Appointment[];
  invoicedAppointments: ReadonlySet<string>;
  businessToday: string;
  businessNowHm: string;
  period: Range;
  scope: string | null;
  materialAmount: number;
  manualIncomingDebt: number;
  invoiceDebts: readonly { amount: number }[];
}

export function homeTotals(input: HomeTotalsInput): HomeTotals {
  const {
    access,
    scopedTransactions,
    scopedAppointments,
    invoicedAppointments,
    businessToday,
    businessNowHm,
    period,
    scope,
    manualIncomingDebt,
    invoiceDebts,
  } = input;
  // В ЦЕНТАХ, как прошлый период (`profit-compare.ts`) и аналитика: сложение
  // евро с плавающей точкой расходилось с ними на копейку («было/стало»).
  let incomeCents = 0;
  let expenseCents = 0;
  for (const tx of scopedTransactions) {
    if (tx.type === "income" || tx.type === "refund")
      incomeCents += Math.round(signedAmount(tx) * 100);
    else if (tx.type === "expense") expenseCents += Math.round(tx.amount * 100);
  }
  const income = incomeCents / 100;
  const expense = expenseCents / 100;
  // Debt via the shared getDebtAmount (prepaid + payments[]) — the web
  // payment_status/paid_amount fields are never mapped by the mobile
  // repository, so «total − paid_amount» would flag every completed
  // visit as fully unpaid (same helper as the dashboard).
  let debt = 0;
  for (const a of access.recordMoney ? scopedAppointments : []) {
    // ОДНА КОРЗИНА. Завершённый визит без оплаты и прошедшая запись, по
    // которой бригадир не отчитался, — для владельца это одни и те же
    // неполученные деньги: «всё равно нужно принимать решение по клиенту».
    // Отдельная строка «Не закрыто» делила бы одно надвое.
    // Прошла — по часам компании, как в календаре: сегодняшняя запись,
    // чьё время кончилось, уже долг.
    if (a.status === "cancelled") continue;
    if (!isPastRecord(a, businessToday, businessNowHm)) continue;
    // Долги — за выбранный период, как список под плиткой.
    if (a.date < period.from || a.date > period.to) continue;
    // Тем же правилом, что лента долгов (`debtRows`): на «Без команды»
    // плитка не брала ни одной записи, а лента — все записи компании.
    if (!inTeamScope(a.team_id, scope)) continue;
    if (invoicedAppointments.has(a.id)) continue;
    debt += getDebtAmount(a);
  }
  const expenseWithMaterials = (expenseCents + Math.round(input.materialAmount * 100)) / 100;
  // НДС здесь НЕ СЧИТАЕТСЯ (плашку убрали, место
  // для неё выберем отдельно). Расчёт цел и покрыт тестами — `summarizeVat`
  // в `@babun/shared/local/finance/vat`; звать его будет новая поверхность.
  return {
    income,
    expense: expenseWithMaterials,
    profit: (incomeCents - Math.round(expenseWithMaterials * 100)) / 100,
    debt: debt + manualIncomingDebt + invoiceDebts.reduce((sum, r) => sum + r.amount, 0),
  };
}

export interface PreviousProfit extends PeriodMoney {
  from: string;
  to: string;
  transactions: FinanceTransaction[];
  materialCost: number;
}

export interface PreviousProfitInput {
  prevTeamRows: FinanceTransaction[];
  prevCompanyRows: FinanceTransaction[];
  scope: string | null;
  accountTeam: ReadonlyMap<string, string | null>;
  readRules: FinanceReadRules;
  debtTeams: DebtTeams;
  requestedClientId: string | undefined;
  scopedAppointments: readonly Appointment[];
  services: readonly Service[];
  prevRange: Range;
  recordMoney: boolean;
}

/** «Было» прошлого периода для «Прибыли» — тем же отбором, что текущий. */
export function previousProfit(input: PreviousProfitInput): PreviousProfit {
  const { scope, accountTeam, readRules, debtTeams, prevRange } = input;
  // Тем же отбором, что текущий период: «было» партнёра — только из строк,
  // которые он видит (в зеркале журнал приходит владельческий).
  const rows = readableTransactions(
    withTeamlessRows(input.prevTeamRows, teamlessLedgerRows(input.prevCompanyRows, scope, accountTeam)),
    readRules,
    debtTeams,
  );
  const transactions = forClient(rows, input.requestedClientId);
  const materials = periodMaterials(
    input.scopedAppointments,
    input.services,
    { from: prevRange.from, to: prevRange.to, scope },
    input.recordMoney,
  );
  return {
    ...periodMoney(transactions, materials.amount),
    from: prevRange.from,
    to: prevRange.to,
    transactions,
    materialCost: materials.amount,
  };
}
