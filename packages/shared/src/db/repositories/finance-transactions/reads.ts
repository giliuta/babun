// Ledger reads: ranges, per-appointment rows, balances and refund totals.

import { isUuid } from "../../../sync/uuid";
import type { FinanceTransaction, TransactionType } from "../../../local/finance/transaction";
import { LEDGER_PAGE_SIZE, rowToTx, type DbSupabase, type Row } from "./shared";

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

/** Сколько id записей уходит в один запрос: 150 uuid — около 5,6 КБ адреса. */
const APPOINTMENT_IDS_PER_REQUEST = 150;

/**
 * Все операции, привязанные к этим записям, — в какой бы день их ни внесли.
 *
 * Календарь ставит деньги записи в день САМОЙ ЗАПИСИ (владелец 2026-10-01:
 * «передвинул запись — всё сдвигается и считается в этот день»), а
 * предоплату за неё могли внести неделей раньше: выборка журнала по дате
 * операции её бы не нашла. Не-uuid id (повтор серии, ещё не сохранённая
 * копия) в базу не уходят — `in` на колонке uuid упал бы целиком.
 */
export async function listTransactionsForAppointments(
  supabase: DbSupabase,
  tenantId: string,
  appointmentIds: readonly string[],
): Promise<FinanceTransaction[]> {
  const ids = [...new Set(appointmentIds.filter(isUuid))];
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += APPOINTMENT_IDS_PER_REQUEST) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("appointment_id", ids.slice(i, i + APPOINTMENT_IDS_PER_REQUEST))
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(`listTransactionsForAppointments: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
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
  const rows: {
    account_id: string | null;
    delta: number | null;
    has_history: boolean | null;
    is_active: boolean | null;
    last_outflow_on: string | null;
    last_tx_on: string | null;
    first_tx_on: string | null;
  }[] = data ?? [];
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
    const page = (data ?? []) as Pick<Row, "id" | "refund_of_id" | "amount">[];
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
