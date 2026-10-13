// Row mapping and preflight guards shared by ledger reads and writes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { exactMoneyAmountToCents } from "../../../common/utils/money";
import type {
  FinanceTransaction,
  TransactionType,
  TransactionSource,
  PaymentMethod,
  AppointmentPaymentKind,
} from "../../../local/finance/transaction";

export type DbSupabase = SupabaseClient<Database>;
export type Row = Database["public"]["Tables"]["finance_transactions"]["Row"];
export type Insert = Database["public"]["Tables"]["finance_transactions"]["Insert"];
export type Update = Database["public"]["Tables"]["finance_transactions"]["Update"];
export const LEDGER_PAGE_SIZE = 1000;

export function localTodayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function rejectFutureLedgerDate(
  occurredOn: string,
  businessToday = localTodayYmd(),
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    throw new Error("Укажите дату финансовой операции");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessToday)) {
    throw new Error("Не удалось определить рабочую дату компании");
  }
  if (occurredOn > businessToday) {
    throw new Error("Финансовую операцию нельзя записать будущей датой");
  }
}

export function assertLedgerAmount(
  type: Exclude<TransactionType, "transfer">,
  amount: number,
): void {
  const cents = exactMoneyAmountToCents(amount, {
    allowNegative: type === "refund",
  });
  if (cents == null) {
    throw new Error(
      "Введите корректную сумму и не больше двух знаков после запятой",
    );
  }
  if (type === "refund" && cents >= 0) {
    throw new Error("Возврат должен уменьшать остаток счёта");
  }
}

export function assertPositiveMoneyAmount(amount: number): void {
  if (exactMoneyAmountToCents(amount) == null) {
    throw new Error(
      "Введите сумму больше нуля и не больше двух знаков после запятой",
    );
  }
}

export function rowToTx(r: Row): FinanceTransaction {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    type: r.type as TransactionType,
    amount: Number(r.amount ?? 0),
    currency: r.currency,
    category_id: r.category_id,
    account_id: r.account_id,
    appointment_id: r.appointment_id,
    appointment_payment_kind:
      (r.appointment_payment_kind ?? null) as AppointmentPaymentKind | null,
    client_id: r.client_id,
    team_id: r.team_id,
    master_id: r.master_id,
    payment_method: (r.payment_method ?? null) as PaymentMethod | null,
    notes: r.notes,
    occurred_on: r.occurred_on,
    // Postgres отдаёт time как «HH:MM:SS» — в модели живёт «HH:MM».
    occurred_time: r.occurred_time ? r.occurred_time.slice(0, 5) : null,
    receipt_url: r.receipt_url,
    // Налог снимком: считать его на лету по текущей ставке нельзя —
    // изменение ставки бесшумно переписало бы прошлую отчётность.
    vat_mode: (r.vat_mode as FinanceTransaction["vat_mode"]) ?? null,
    vat_rate: r.vat_rate ?? null,
    vat_amount: r.vat_amount ?? null,
    transfer_group_id: r.transfer_group_id,
    invoice_id: r.invoice_id,
    debt_id: r.debt_id,
    refund_of_id: r.refund_of_id,
    reversal_kind: (r.reversal_kind ?? null) as FinanceTransaction["reversal_kind"],
    source: r.source as TransactionSource,
    // Колонки ещё нет в сгенерированных типах (миграция 20261004080218).
    from_calendar: (r as { from_calendar?: boolean | null }).from_calendar === true,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
  };
}
