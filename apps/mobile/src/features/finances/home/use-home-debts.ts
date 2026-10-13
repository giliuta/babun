import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Debt } from "@babun/shared/local/finance/debt";
import {
  calculateInvoiceSettlement,
  invoicedAppointmentIds,
} from "@babun/shared/local/finance/invoice-ledger";
import { NO_TEAM } from "../accounts-sections";
import { invoiceDebtRows, manualDebtRows } from "../debt-rows";
import { readableDebts, type FinanceReadRules } from "../finance-read-rules";
import type { Period } from "../period";
import { forClient } from "./home-scope";
import type { HomeReferences } from "./use-home-references";

export interface HomeDebtsInput {
  refs: Pick<HomeReferences, "invoices" | "invoicePayments" | "clients" | "categories">;
  scopedInvoices: HomeReferences["invoices"];
  scopedAppointments: readonly Appointment[];
  debtsData: Debt[] | undefined;
  debtPaidData: Map<string, number> | undefined;
  period: Period;
  businessToday: string;
  scope: string | null;
  readRules: FinanceReadRules;
  requestedClientId: string | undefined;
}

/** Everything owed in the period: invoiced work, unpaid invoices, manual
 *  debts and their payments. */
export function useHomeDebts(input: HomeDebtsInput) {
  const { scopedInvoices, scopedAppointments, period, businessToday, scope, readRules, requestedClientId } = input;
  const { invoices, invoicePayments, clients, categories } = input.refs;
  // ОДНИ И ТЕ ЖЕ ДЕНЬГИ СЧИТАЮТСЯ ОДИН РАЗ.
  //
  // «Долги» — работа сделана, деньги не получены и ничем не оформлены. Как
  // только на эту работу выставлен инвойс, те же деньги показывает плитка
  // «Документы» («ждут оплату»). Без этого исключения одна сотня евро сидела
  // в обеих цифрах сразу, и прибыль с долгами врали вместе. Аннулированный
  // инвойс не считается — он ничего не ждёт.
  //
  // ЖИВЁТ СНАРУЖИ `totals`, потому что этим набором обязаны пользоваться ОБА:
  // и цифра на плитке, и список под ней. Когда правило знала одна плитка,
  // она честно показывала «Долги €0», а список под ней печатал должника на
  // €250 — две витрины спорили об одних деньгах.
  const invoicedAppointments = useMemo(
    // Правило «эта работа уже под счётом» живёт ОДНОЙ функцией на продукт
    // (`invoicedAppointmentIds`): им считают и плитка «Долги», и лента под ней,
    // и `DebtorsList`. Аннулированные, отменённые и сами кредит-ноты из набора
    // выпадают — тест правила лежит рядом с ним.
    () => invoicedAppointmentIds(invoices),
    [invoices],
  );

  // НЕОПЛАЧЕННЫЕ ИНВОЙСЫ — ДОЛГОМ (владелец 04.10: «выставлен инвойс, оплаты
  // нет — он переходит в долг»). Работа под инвойсом из долгов записей уже
  // исключена (`invoicedAppointments`): её деньги — здесь, остатком инвойса.
  const invoiceDebtSources = useMemo(
    () =>
      scopedInvoices.map((inv) => ({
        ...inv,
        remaining: calculateInvoiceSettlement(inv, invoicePayments[inv.id] ?? []).remaining,
      })),
    [scopedInvoices, invoicePayments],
  );
  const invoiceDebts = useMemo(
    () =>
      invoiceDebtRows(
        invoiceDebtSources,
        { clients, appointments: scopedAppointments },
        { from: period.from, to: period.to, today: businessToday, teamId: scope },
      ),
    [invoiceDebtSources, clients, scopedAppointments, period.from, period.to, businessToday, scope],
  );

  const debtsData = input.debtsData;
  // Пустышки через useMemo, а не `?? []` в выражении: новый литерал на каждый
  // рендер ломает мемоизацию списка долгов, ради которой он и написан.
  const debts = useMemo(() => {
    // «Долги: Не видит» в команде долга — его нет ни в ленте, ни в плитке.
    const rows = readableDebts(debtsData ?? [], readRules);
    // Ручной долг, заведённый под «Без команды», пишется без команды — и здесь
    // же обязан найтись (раньше не показывался ни под одним чипом).
    const scoped = scope === NO_TEAM ? rows.filter((debt) => debt.team_id == null) : rows;
    // «Финансы клиента»: записи, инвойсы и операции уже сужены до него, а
    // ручные долги — нет, и чужой долг стоял в его плитке (аудит 2026-09-30).
    return forClient(scoped, requestedClientId);
  }, [debtsData, scope, requestedClientId, readRules]);
  const debtPaidData = input.debtPaidData;
  const debtPaid = useMemo(
    () => debtPaidData ?? new Map<string, number>(),
    [debtPaidData],
  );

  // ПЛИТКА И СПИСОК ПОД НЕЙ СЧИТАЮТ ОДНОЙ ФУНКЦИЕЙ. «Долги» — это всё, что
  // должны МНЕ: долги записей плюс ручные входящие. «Я должен» в плитку не
  // подмешивается: одни деньги придут, другие уйдут, и общая сумма не значила
  // бы ничего (владелец 2026-09-10 — две стороны, переключатель между ними).
  const manualIncomingDebt = useMemo(
    () =>
      manualDebtRows(
        debts,
        debtPaid,
        { clients, categories },
        { today: businessToday, direction: "incoming" },
      ).reduce((sum, r) => sum + r.amount, 0),
    [debts, debtPaid, clients, categories, businessToday],
  );
  return { invoicedAppointments, invoiceDebts, debts, debtPaid, manualIncomingDebt };
}
