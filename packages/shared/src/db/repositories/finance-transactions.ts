// finance_transactions repository — the new /finances ledger.
//
// One row per immutable money movement. Appointment prepayments and final
// settlements are separate auto events; manual rows come from the finance
// forms. Transfers are stored as a pair sharing transfer_group_id. Refunds
// carry refund_of_id pointing at the exact original income.

export { rowToTx } from "./finance-transactions/shared";
export {
  accountHasLedgerHistory,
  listAccountBalances,
  listRefundTotals,
  listTransactionsForAppointments,
  listTransactionsForRange,
  type AccountBalanceRow,
  type ListRangeOptions,
} from "./finance-transactions/reads";
export {
  deleteTransaction,
  insertTransaction,
  updateTransaction,
  type TransactionDraft,
} from "./finance-transactions/writes";
export {
  resetAppointmentPayment,
  setAppointmentPrepayment,
} from "./finance-transactions/appointment-money";
export {
  createTransfer,
  deleteTransfer,
  type TransferDraft,
} from "./finance-transactions/transfers";
