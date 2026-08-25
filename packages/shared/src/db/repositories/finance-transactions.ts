// finance_transactions repository — the new /finances ledger.
//
// One row per immutable money movement. Appointment prepayments and final
// settlements are separate auto events; manual rows come from the finance
// forms. Transfers are stored as a pair sharing transfer_group_id. Refunds
// carry refund_of_id pointing at the exact original income.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { rpcArgs } from "../rpc-args";
import { randomUuid } from "../../sync/uuid";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type {
  FinanceTransaction,
  TransactionType,
  TransactionSource,
  PaymentMethod,
  AppointmentPaymentKind,
} from "../../local/finance/transaction";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["finance_transactions"]["Row"];
type Insert = Database["public"]["Tables"]["finance_transactions"]["Insert"];
const LEDGER_PAGE_SIZE = 1000;

function localTodayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rejectFutureLedgerDate(
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

function assertLedgerAmount(
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

function assertPositiveMoneyAmount(amount: number): void {
  if (exactMoneyAmountToCents(amount) == null) {
    throw new Error(
      "Введите сумму больше нуля и не больше двух знаков после запятой",
    );
  }
}

function rowToTx(r: Row): FinanceTransaction {
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
    receipt_url: r.receipt_url,
    // Налог снимком: считать его на лету по текущей ставке нельзя —
    // изменение ставки бесшумно переписало бы прошлую отчётность.
    vat_mode: (r.vat_mode as FinanceTransaction["vat_mode"]) ?? null,
    vat_rate: r.vat_rate ?? null,
    vat_amount: r.vat_amount ?? null,
    transfer_group_id: r.transfer_group_id,
    invoice_id: r.invoice_id,
    refund_of_id: r.refund_of_id,
    source: r.source as TransactionSource,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
  };
}

export interface ListRangeOptions {
  brigadeIds?: string[];
  accountIds?: string[];
  categoryIds?: string[];
  clientIds?: string[];
  types?: TransactionType[];
}

/**
 * Range is inclusive on both ends. Dates are YYYY-MM-DD strings,
 * compared against `occurred_on`.
 */
export async function listTransactionsForRange(
  supabase: DbSupabase,
  tenantId: string,
  fromDate: string,
  toDate: string,
  opts: ListRangeOptions = {},
): Promise<FinanceTransaction[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += LEDGER_PAGE_SIZE) {
    let q = supabase
      .from("finance_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("occurred_on", fromDate)
      .lte("occurred_on", toDate);
    if (opts.brigadeIds?.length) q = q.in("team_id", opts.brigadeIds);
    if (opts.accountIds?.length) q = q.in("account_id", opts.accountIds);
    if (opts.categoryIds?.length) q = q.in("category_id", opts.categoryIds);
    if (opts.clientIds?.length) q = q.in("client_id", opts.clientIds);
    if (opts.types?.length) q = q.in("type", opts.types);
    const { data, error } = await q
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + LEDGER_PAGE_SIZE - 1);
    if (error) throw new Error(`listTransactionsForRange: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < LEDGER_PAGE_SIZE) break;
  }
  return rows.map(rowToTx);
}

/** Строка серверного агрегата `account_balances` — одна на счёт тенанта плюс
 *  одна «ничья». */
export interface AccountBalanceRow {
  /** NULL — операции без счёта: деньги, не привязанные ни к одной кассе.
   *  Их нельзя выкидывать: без этой строки «Счета» и «Финансы» расходятся
   *  молча (в проде такая строка есть). */
  account_id: string | null;
  /** Сумма движений БЕЗ opening_balance: balance = opening_balance + delta.
   *  Стартовый остаток клиент и так знает из listAccounts. */
  delta: number;
  /** Была ли по счёту хоть одна операция. */
  has_history: boolean;
  is_active: boolean;
  /** Последний вывод денег со счёта (исходящее плечо перевода), YYYY-MM-DD. */
  last_outflow_on: string | null;
  last_tx_on: string | null;
  first_tx_on: string | null;
}

/**
 * Остатки всех счетов одним запросом. Сумма считается на сервере: клиент
 * больше не тянет весь журнал ради одного числа.
 *
 * Функция owner-only и на чужой роли БРОСАЕТ исключение, а не отдаёт пусто —
 * пустой ответ экран напечатал бы как «€0», то есть соврал бы про деньги.
 * Поэтому ошибку здесь нельзя глотать: она обязана дойти до экрана.
 */
export async function listAccountBalances(
  supabase: DbSupabase,
  tenantId: string,
): Promise<AccountBalanceRow[]> {
  const { data, error } = await supabase.rpc("account_balances", {
    p_tenant: tenantId,
  });
  if (error) throw new Error(error.message || "Не удалось посчитать остатки");
  // Генератор типов Supabase не размечает NULL в колонках setof-функции, а
  // они здесь настоящие: строка «без счёта» и счёт без единой операции.
  const rows: Array<{
    account_id: string | null;
    delta: number | null;
    has_history: boolean | null;
    is_active: boolean | null;
    last_outflow_on: string | null;
    last_tx_on: string | null;
    first_tx_on: string | null;
  }> = data ?? [];
  return rows.map((r) => ({
    account_id: r.account_id,
    delta: Number(r.delta ?? 0),
    has_history: r.has_history ?? false,
    is_active: r.is_active ?? true,
    last_outflow_on: r.last_outflow_on,
    last_tx_on: r.last_tx_on,
    first_tx_on: r.first_tx_on,
  }));
}

/**
 * Итоги счёта за период из серверного `account_period_totals`.
 *
 * ВСЕ ДЕНЕЖНЫЕ КОЛОНКИ ПРИХОДЯТ УЖЕ СО ЗНАКОМ: income ≥ 0, expense ≤ 0,
 * refund ≤ 0, transfer_in ≥ 0, transfer_out ≤ 0. Клиент их только
 * СКЛАДЫВАЕТ. Написать «− expense» или «− refund» значит вычесть дважды;
 * контракт закреплён тестом apps/mobile/src/features/finances/account-period.
 */
export interface AccountPeriodTotals {
  /** NULL — та же строка «операции без счёта», что и в account_balances. */
  account_id: string | null;
  /** Полный остаток на начало периода (opening_balance + всё до p_from). */
  opening_before: number;
  income: number;
  expense: number;
  refund: number;
  transfer_in: number;
  transfer_out: number;
  /** Подписанная сумма всего, КРОМЕ переводов, — единственная цифра героя. */
  net: number;
}

/**
 * Период включает обе границы; даты — строки YYYY-MM-DD по `occurred_on`.
 * Owner-only, как и account_balances: ошибка роли обязана дойти до экрана.
 */
export async function listAccountPeriodTotals(
  supabase: DbSupabase,
  tenantId: string,
  fromDate: string,
  toDate: string,
): Promise<AccountPeriodTotals[]> {
  const { data, error } = await supabase.rpc("account_period_totals", {
    p_tenant: tenantId,
    p_from: fromDate,
    p_to: toDate,
  });
  if (error) throw new Error(error.message || "Не удалось посчитать период");
  // Тот же пробел генератора, что и в account_balances: все колонки, кроме
  // account_id, — числа, и пустыми они приходить не должны, но защита от
  // NULL здесь дешевле, чем NaN в остатке.
  const rows: Array<
    { account_id: string | null } & Record<
      Exclude<keyof AccountPeriodTotals, "account_id">,
      number | null
    >
  > = data ?? [];
  return rows.map((r) => ({
    account_id: r.account_id,
    opening_before: Number(r.opening_before ?? 0),
    income: Number(r.income ?? 0),
    expense: Number(r.expense ?? 0),
    refund: Number(r.refund ?? 0),
    transfer_in: Number(r.transfer_in ?? 0),
    transfer_out: Number(r.transfer_out ?? 0),
    net: Number(r.net ?? 0),
  }));
}

/** Does the account carry ANY ledger rows? Mirrors the server-side
 * `guard_account_financial_history` freeze checks: the settings screen uses
 * this to disable kind/opening/brigade edits instead of surfacing a server
 * error after the fact. */
export async function accountHasLedgerHistory(
  supabase: DbSupabase,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("id")
    .eq("account_id", accountId)
    .limit(1);
  if (error) throw new Error(`accountHasLedgerHistory: ${error.message}`);
  return (data ?? []).length > 0;
}

/** All-time refunds grouped by original income. Refunds may fall outside the
 * currently viewed period, so this read is deliberately global.
 *
 * Keyset-пагинация (.gt по id), не offset: набор растёт, и конкурентная
 * вставка возврата между страницами сдвигала бы окно range — сумма «уже
 * возвращено» исказилась бы, а по ней режется кап повторного возврата. */
export async function listRefundTotals(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let lastId: string | null = null;
  for (;;) {
    let q = supabase
      .from("finance_transactions")
      .select("id, refund_of_id, amount")
      .eq("tenant_id", tenantId)
      .eq("type", "refund")
      .not("refund_of_id", "is", null);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(LEDGER_PAGE_SIZE);
    if (error) throw new Error(`listRefundTotals: ${error.message}`);
    const page = (data ?? []) as Array<
      Pick<Row, "id" | "refund_of_id" | "amount">
    >;
    for (const row of page) {
      if (!row.refund_of_id) continue;
      totals.set(
        row.refund_of_id,
        (totals.get(row.refund_of_id) ?? 0) + Math.abs(Number(row.amount ?? 0)),
      );
    }
    if (page.length < LEDGER_PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }
  return totals;
}

export interface TransactionDraft {
  type: Exclude<TransactionType, "transfer">; // transfers use a separate helper
  amount: number;
  category_id?: string | null;
  account_id?: string | null;
  appointment_id?: string | null;
  client_id?: string | null;
  team_id?: string | null;
  master_id?: string | null;
  payment_method?: PaymentMethod | null;
  notes?: string | null;
  occurred_on?: string;
  /** Tenant-local date supplied by the UI for preflight validation only. */
  business_today?: string;
  receipt_url?: string | null;
  /** «Без НДС» здесь — не пустое значение, а решение оператора: триггер
   *  обязан его уважать, даже когда у компании налог включён. */
  vat_mode?: "none" | "inclusive" | "exclusive" | null;
  invoice_id?: string | null;
  refund_of_id?: string | null;
  /** Клиентский PK строки. Стабилен на время попытки: ретрай после
   *  потерянного ответа или двойной тап упирается в duplicate key,
   *  который трактуется как успех — деньги не задваиваются (паттерн
   *  request_id переводов). */
  request_id?: string;
}

export async function insertTransaction(
  supabase: DbSupabase,
  tenantId: string,
  draft: TransactionDraft,
): Promise<FinanceTransaction> {
  assertLedgerAmount(draft.type, draft.amount);
  const businessToday = draft.business_today ?? localTodayYmd();
  const occurredOn = draft.occurred_on ?? businessToday;
  rejectFutureLedgerDate(occurredOn, businessToday);
  const insert: Insert = {
    ...(draft.request_id ? { id: draft.request_id } : {}),
    tenant_id: tenantId,
    type: draft.type,
    amount: draft.amount,
    category_id: draft.category_id ?? null,
    account_id: draft.account_id ?? null,
    appointment_id: draft.appointment_id ?? null,
    client_id: draft.client_id ?? null,
    team_id: draft.team_id ?? null,
    master_id: draft.master_id ?? null,
    payment_method: draft.payment_method ?? null,
    notes: draft.notes ?? null,
    occurred_on: occurredOn,
    receipt_url: draft.receipt_url ?? null,
    vat_mode: draft.vat_mode ?? null,
    invoice_id: draft.invoice_id ?? null,
    refund_of_id: draft.refund_of_id ?? null,
    source: "manual",
  };
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert(insert)
    .select("*")
    .single();
  if (error && draft.request_id && error.code === "23505") {
    // Строка с этим id уже закоммичена прошлой попыткой — это успех.
    const { data: existing, error: readError } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("id", draft.request_id)
      .single();
    if (readError || !existing) {
      throw new Error(readError?.message ?? "Не удалось сохранить финансовую операцию");
    }
    return rowToTx(existing as Row);
  }
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось сохранить финансовую операцию");
  }
  return rowToTx(data as Row);
}

export async function updateTransaction(
  supabase: DbSupabase,
  id: string,
  patch: Partial<TransactionDraft>,
): Promise<void> {
  if (patch.amount !== undefined) assertPositiveMoneyAmount(patch.amount);
  if (patch.occurred_on !== undefined) {
    rejectFutureLedgerDate(
      patch.occurred_on,
      patch.business_today ?? localTodayYmd(),
    );
  }
  const update: Partial<Database["public"]["Tables"]["finance_transactions"]["Update"]> = {};
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.category_id !== undefined) update.category_id = patch.category_id;
  if (patch.account_id !== undefined) update.account_id = patch.account_id;
  if (patch.client_id !== undefined) update.client_id = patch.client_id;
  if (patch.team_id !== undefined) update.team_id = patch.team_id;
  if (patch.master_id !== undefined) update.master_id = patch.master_id;
  if (patch.payment_method !== undefined) update.payment_method = patch.payment_method;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.occurred_on !== undefined) update.occurred_on = patch.occurred_on;
  if (patch.receipt_url !== undefined) update.receipt_url = patch.receipt_url;
  if (patch.vat_mode !== undefined) update.vat_mode = patch.vat_mode;
  const { data, error } = await supabase
    .from("finance_transactions")
    .update(update)
    .eq("id", id)
    .eq("source", "manual")
    .in("type", ["income", "expense"])
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      error?.message ?? "Операция недоступна или связана с инвойсом",
    );
  }
}

export async function deleteTransaction(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("finance_transactions")
    .delete()
    .eq("id", id)
    .eq("source", "manual")
    .neq("type", "transfer")
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      error?.message ?? "Операция недоступна или связана с инвойсом",
    );
  }
}

/**
 * Atomically undo an appointment payment on the server. The RPC locks the
 * appointment, writes linked refunds for every settlement receipt and clears
 * the settlement mirrors in the same transaction. Prepayment receipts remain;
 * invoice-linked refunds reopen the invoice through the ledger trigger.
 */
export async function undoAppointmentPayment(
  supabase: DbSupabase,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase.rpc("undo_appointment_payment", {
    p_appointment_id: appointmentId,
  });
  if (error) throw new Error(error.message || "Не удалось отменить оплату");
}

/**
 * Permanently reset every outstanding receipt for an appointment. The server
 * appends linked refunds for prepayment and settlement events, clears the
 * payment mirrors and reopens appointment/invoice debt in one transaction.
 */
export async function resetAppointmentPayment(
  supabase: DbSupabase,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase.rpc("reset_appointment_payment", {
    p_appointment_id: appointmentId,
  });
  if (error) throw new Error(error.message || "Не удалось отменить оплату");
}

/**
 * Set the absolute prepayment before settlement. Reducing it creates linked
 * refund events; changing its tender refunds the old account and records a
 * fresh receipt on the matching account. This must never enter the offline
 * queue because the appointment and ledger commit atomically on the server.
 */
export async function setAppointmentPrepayment(
  supabase: DbSupabase,
  appointmentId: string,
  amount: number,
  paymentMethod: PaymentMethod | null,
): Promise<void> {
  const { error } = await supabase.rpc(
    "set_appointment_prepayment",
    rpcArgs<"set_appointment_prepayment">({
      p_appointment_id: appointmentId,
      p_amount: amount,
      p_payment_method: paymentMethod,
    }),
  );
  if (error) {
    throw new Error(error.message || "Не удалось изменить предоплату");
  }
}

export interface TransferDraft {
  /** Stable per user intent. Reusing it after a lost response is safe. */
  request_id?: string;
  from_account_id: string;
  to_account_id: string;
  amount: number; // positive
  occurred_on?: string;
  notes?: string | null;
  // Команды здесь нет: обе ноги перевода привязаны к СЧЕТАМ, а команду
  // сервер выводит из них сам. Поле принимало значение от веба и никуда не
  // доезжало — вторая, ничего не решающая правда о принадлежности денег.
}

/**
 * Record a transfer through the owner-only database RPC. Account locking,
 * tenant/team validation, overdraft prevention and request idempotency all
 * live server-side; clients never write individual transfer legs.
 */
export async function createTransfer(
  supabase: DbSupabase,
  tenantId: string,
  t: TransferDraft,
): Promise<{ source: FinanceTransaction; destination: FinanceTransaction }> {
  // tenantId remains in the public signature for web/mobile compatibility.
  // The RPC derives the authoritative tenant from auth.uid() and rejects any
  // cross-tenant account UUID, so this client value is never trusted.
  void tenantId;
  assertPositiveMoneyAmount(t.amount);
  if (t.occurred_on) rejectFutureLedgerDate(t.occurred_on);
  const { data, error } = await supabase.rpc(
    "record_account_transfer",
    rpcArgs<"record_account_transfer">({
      p_request_id: t.request_id ?? randomUuid(),
      p_from_account_id: t.from_account_id,
      p_to_account_id: t.to_account_id,
      p_amount: t.amount,
      p_notes: t.notes ?? null,
      ...(t.occurred_on ? { p_occurred_on: t.occurred_on } : {}),
    }),
  );
  if (error || !data || data.length !== 2) {
    throw new Error(error?.message ?? "Перевод не был записан полностью");
  }
  const rows = data as Row[];
  // legs are distinguished by sign (source negative, destination positive)
  const src = rows.find((r) => Number(r.amount) < 0);
  const dst = rows.find((r) => Number(r.amount) > 0);
  if (!src || !dst) throw new Error("createTransfer: could not identify legs");
  return { source: rowToTx(src), destination: rowToTx(dst) };
}

/**
 * Cancel a transfer pair through the owner-only idempotent RPC. The request
 * tombstone is preserved, so retrying either create or delete can never
 * resurrect a previously cancelled transfer.
 */
export async function deleteTransfer(
  supabase: DbSupabase,
  groupId: string,
): Promise<void> {
  const { error } = await supabase.rpc("delete_account_transfer", {
    p_transfer_group_id: groupId,
  });
  if (error) throw new Error(error.message || "Не удалось отменить перевод");
}
