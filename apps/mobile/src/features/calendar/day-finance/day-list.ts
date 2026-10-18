import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import type { DayView } from "./types";

/** Rows under the tiles for the picked tile (and account). */
export function dayList({
  view,
  legacyExtras,
  incomeRows,
  expenseRows,
  accountPick,
  plannedRecords,
  debtRecords,
  ledgerLoading,
  dayPlanSize,
}: {
  view: DayView;
  legacyExtras: DayExtra[];
  incomeRows: FinanceTransaction[];
  expenseRows: FinanceTransaction[];
  /** undefined — every account; null — rows without an account. */
  accountPick: string | null | undefined;
  plannedRecords: Appointment[];
  debtRecords: Appointment[];
  ledgerLoading: boolean;
  dayPlanSize: number;
}): {
  listExtras: DayExtra[];
  listTx: FinanceTransaction[];
  listRecords: Appointment[];
  listLoading: boolean;
  listEmpty: boolean;
} {
  const listExtras: DayExtra[] =
    view === "income" || view === "expense"
      ? legacyExtras.filter((e) => e.kind === view)
      : view === "all"
        ? legacyExtras
        : [];
  const sideRows = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
  // Выбран счёт — только его строки (материалы счёта не имеют и уходят).
  const listTx =
    accountPick === undefined
      ? sideRows
      : sideRows.filter(
          (tx) => !tx.id.startsWith("material:") && (tx.account_id ?? null) === accountPick,
        );
  const listRecords = view === "planned" ? plannedRecords : view === "debt" ? debtRecords : [];
  const listLoading = (view === "income" || view === "expense" || view === "all") && ledgerLoading;
  const listEmpty =
    view === "all"
      ? dayPlanSize === 0 && listExtras.length === 0
      : listTx.length === 0 && listExtras.length === 0 && listRecords.length === 0;
  return { listExtras, listTx, listRecords, listLoading, listEmpty };
}
