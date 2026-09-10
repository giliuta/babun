// debts repository — долг как собственная строка (STORY-080).
//
// Погашение сюда НЕ пишется: платёж по долгу — обычная операция журнала с
// `debt_id`, и остаток считается по ней. Поэтому здесь нет ни статуса, ни
// поля «уплачено»: колонка, дублирующая деньги, разъезжается с ними на первой
// же правке платежа — это уже было с плиткой и списком долгов записей.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type { Debt, DebtDirection } from "../../local/finance/debt";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["debts"]["Row"];

const DEBTS_PAGE_SIZE = 1000;

function rowToDebt(r: Row): Debt {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    direction: r.direction as DebtDirection,
    client_id: r.client_id,
    counterparty: r.counterparty,
    amount: Number(r.amount ?? 0),
    currency: r.currency,
    category_id: r.category_id,
    note: r.note,
    occurred_on: r.occurred_on,
    // Postgres отдаёт time как «HH:MM:SS» — в модели живёт «HH:MM»
    // (тот же закон, что у операции журнала).
    occurred_time: r.occurred_time ? r.occurred_time.slice(0, 5) : null,
    team_id: r.team_id,
    created_at: r.created_at,
  };
}

export interface DebtRangeOptions {
  /** Команда, если экран сужен до одной. */
  teamId?: string | null;
}

/**
 * Долги за период по дню возникновения. Окно — то же, что у долгов записей:
 * список под цифрой обязан набираться тем же правилом, что сама цифра.
 */
export async function listDebts(
  supabase: DbSupabase,
  tenantId: string,
  from: string,
  to: string,
  options: DebtRangeOptions = {},
): Promise<Debt[]> {
  let q = supabase
    .from("debts")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("occurred_on", from)
    .lte("occurred_on", to);
  if (options.teamId) q = q.eq("team_id", options.teamId);
  const { data, error } = await q
    .order("occurred_on", { ascending: false })
    .limit(DEBTS_PAGE_SIZE);
  if (error) throw new Error(`listDebts: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToDebt);
}

/**
 * Σ платежей по каждому долгу — НАМЕРЕННО без окна периода (та же логика, что
 * у `listRefundTotals`). Долг из августа можно закрыть в октябре, и оконная
 * выборка занижала бы уплаченное: закрытый долг вечно висел бы в списке.
 */
export async function listDebtPaidTotals(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let lastId: string | null = null;
  for (;;) {
    let q = supabase
      .from("finance_transactions")
      .select("id, debt_id, amount")
      .eq("tenant_id", tenantId)
      .not("debt_id", "is", null);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(DEBTS_PAGE_SIZE);
    if (error) throw new Error(`listDebtPaidTotals: ${error.message}`);
    const page = (data ?? []) as Array<{
      id: string;
      debt_id: string | null;
      amount: number;
    }>;
    for (const row of page) {
      if (!row.debt_id) continue;
      totals.set(
        row.debt_id,
        (totals.get(row.debt_id) ?? 0) + Math.abs(Number(row.amount ?? 0)),
      );
    }
    if (page.length < DEBTS_PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }
  return totals;
}

export interface NewDebt {
  direction: DebtDirection;
  counterparty: string;
  amount: number;
  occurred_on: string;
  /** «HH:MM» по часам компании; null — без часа. */
  occurred_time?: string | null;
  client_id?: string | null;
  category_id?: string | null;
  note?: string | null;
  team_id?: string | null;
  /** Рабочая дата компании — для проверки «не будущим числом». */
  business_today?: string;
}

function localTodayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Проверки повторяют CHECK-и таблицы, но говорят по-человечески: до базы
 *  доезжает `violates check constraint "debts_amount_check"`, и показать это
 *  владельцу нельзя. */
export function assertDebtDraft(draft: NewDebt): void {
  if (!draft.counterparty.trim()) {
    throw new Error("Укажите, кто должен");
  }
  if (exactMoneyAmountToCents(draft.amount) == null) {
    throw new Error("Введите сумму долга — не больше двух знаков после запятой");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurred_on)) {
    throw new Error("Укажите дату долга");
  }
  if (draft.occurred_on > (draft.business_today ?? localTodayYmd())) {
    throw new Error("Долг нельзя записать будущей датой");
  }
}

export async function insertDebt(
  supabase: DbSupabase,
  tenantId: string,
  draft: NewDebt,
): Promise<Debt> {
  assertDebtDraft(draft);
  const { data, error } = await supabase
    .from("debts")
    .insert({
      tenant_id: tenantId,
      direction: draft.direction,
      counterparty: draft.counterparty.trim(),
      amount: draft.amount,
      occurred_on: draft.occurred_on,
      occurred_time: draft.occurred_time ?? null,
      client_id: draft.client_id ?? null,
      category_id: draft.category_id ?? null,
      note: draft.note?.trim() || null,
      team_id: draft.team_id ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось сохранить долг");
  }
  return rowToDebt(data as Row);
}

export type DebtPatch = Partial<Omit<NewDebt, "business_today">> & {
  business_today?: string;
};

export async function updateDebt(
  supabase: DbSupabase,
  id: string,
  patch: DebtPatch,
): Promise<void> {
  const update: Database["public"]["Tables"]["debts"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.direction !== undefined) update.direction = patch.direction;
  if (patch.counterparty !== undefined) {
    if (!patch.counterparty.trim()) throw new Error("Укажите, кто должен");
    update.counterparty = patch.counterparty.trim();
  }
  if (patch.amount !== undefined) {
    if (exactMoneyAmountToCents(patch.amount) == null) {
      throw new Error("Введите сумму долга — не больше двух знаков после запятой");
    }
    update.amount = patch.amount;
  }
  if (patch.occurred_on !== undefined) {
    if (patch.occurred_on > (patch.business_today ?? localTodayYmd())) {
      throw new Error("Долг нельзя записать будущей датой");
    }
    update.occurred_on = patch.occurred_on;
  }
  if (patch.occurred_time !== undefined) update.occurred_time = patch.occurred_time;
  if (patch.client_id !== undefined) update.client_id = patch.client_id;
  if (patch.category_id !== undefined) update.category_id = patch.category_id;
  if (patch.note !== undefined) update.note = patch.note?.trim() || null;
  if (patch.team_id !== undefined) update.team_id = patch.team_id;

  const { data, error } = await supabase
    .from("debts")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Долг не найден или недоступен");
  }
}

/** Удаляет долг. Платежи по нему ОСТАЮТСЯ: `debt_id` объявлен
 *  `on delete set null` — деньги случились, они лежат на счёте и в прибыли,
 *  они просто перестают быть привязаны к долгу. */
export async function deleteDebt(supabase: DbSupabase, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("debts")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Долг не найден или недоступен");
  }
}
