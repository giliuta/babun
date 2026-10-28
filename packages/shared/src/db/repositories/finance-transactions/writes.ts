// Manual ledger rows: insert, edit and delete into «Удалённые операции».

import type { TeamFilledByTrigger } from "../../team-filled-by-trigger";
import type {
  FinanceTransaction,
  TransactionType,
  PaymentMethod,
} from "../../../local/finance/transaction";
import { REQUEST_ID_REUSED, sameLedgerContent } from "./duplicate";
import {
  assertLedgerAmount,
  assertPositiveMoneyAmount,
  localTodayYmd,
  rejectFutureLedgerDate,
  rowToTx,
  type DbSupabase,
  type Insert,
  type Row,
  type Update,
} from "./shared";

/** Правка упёрлась в строку, которой уже нет. */
const OPERATION_GONE = "Операцию уже удалили на другом устройстве";

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
  /** HH:MM по часам бизнеса; null — без времени. */
  occurred_time?: string | null;
  /** Tenant-local date supplied by the UI for preflight validation only. */
  business_today?: string;
  receipt_url?: string | null;
  /** «Без НДС» здесь — не пустое значение, а решение оператора: триггер
   *  обязан его уважать, даже когда у компании налог включён. */
  vat_mode?: "none" | "inclusive" | "exclusive" | null;
  /** Снимок налога, выбранный человеком (ставка тапом в «Итого»). Едут
   *  парой: `fill_transaction_vat` сверяет налог с суммой и ставкой и берёт
   *  их вместо настроек. Пусто — ставку подставит сервер. */
  vat_rate?: number | null;
  vat_amount?: number | null;
  invoice_id?: string | null;
  /** Гасит этот долг. Долг — не деньги; движением денег становится ровно эта
   *  операция, поэтому платёж живёт в журнале, а не в таблице долгов. */
  debt_id?: string | null;
  refund_of_id?: string | null;
  /** Внесена кнопкой «Финансы дня» календаря: только такие операции без
   *  записи день календаря и считает. */
  from_calendar?: boolean;
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
  const insert: TeamFilledByTrigger<Insert> = {
    ...(draft.request_id ? { id: draft.request_id } : {}),
    ...(draft.from_calendar ? { from_calendar: true } : {}),
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
    occurred_time: draft.occurred_time ?? null,
    receipt_url: draft.receipt_url ?? null,
    vat_mode: draft.vat_mode ?? null,
    ...(draft.vat_rate != null && draft.vat_amount != null
      ? { vat_rate: draft.vat_rate, vat_amount: draft.vat_amount }
      : {}),
    invoice_id: draft.invoice_id ?? null,
    debt_id: draft.debt_id ?? null,
    refund_of_id: draft.refund_of_id ?? null,
    source: "manual",
  };
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert(insert as Insert)
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
    const stored = rowToTx(existing as Row);
    // Тот же id, но другое содержимое — это не повтор, а новая попытка поверх
    // записанной: честная ошибка вместо «успеха» с чужой суммой.
    if (!sameLedgerContent(stored, draft)) throw new Error(REQUEST_ID_REUSED);
    return stored;
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
  const update: TeamFilledByTrigger<Update> = {};
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.category_id !== undefined) update.category_id = patch.category_id;
  if (patch.account_id !== undefined) update.account_id = patch.account_id;
  if (patch.client_id !== undefined) update.client_id = patch.client_id;
  if (patch.team_id !== undefined) update.team_id = patch.team_id;
  if (patch.master_id !== undefined) update.master_id = patch.master_id;
  if (patch.payment_method !== undefined) update.payment_method = patch.payment_method;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.occurred_on !== undefined) update.occurred_on = patch.occurred_on;
  if (patch.occurred_time !== undefined) update.occurred_time = patch.occurred_time;
  if (patch.receipt_url !== undefined) update.receipt_url = patch.receipt_url;
  if (patch.vat_mode !== undefined) update.vat_mode = patch.vat_mode;
  // Снимок налога — только парой, как на вставке: ставка без суммы сервер
  // пересобрал бы по настройкам компании.
  if (patch.vat_rate != null && patch.vat_amount != null) {
    update.vat_rate = patch.vat_rate;
    update.vat_amount = patch.vat_amount;
  }
  if (patch.debt_id !== undefined) update.debt_id = patch.debt_id;
  const { data, error } = await supabase
    .from("finance_transactions")
    .update(update as Update)
    .eq("id", id)
    .eq("source", "manual")
    .in("type", ["income", "expense"])
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // Ноль строк — либо операции уже нет (её удалили на другом устройстве),
    // либо она есть, но правке закрыта (инвойс, не ручная). Различает чтение.
    const { data: still, error: readError } = await supabase
      .from("finance_transactions")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    throw new Error(
      !readError && !still ? OPERATION_GONE : "Операция недоступна или связана с инвойсом",
    );
  }
}

/**
 * Удалить операцию В «УДАЛЁННЫЕ ОПЕРАЦИИ»: 30 дней её можно
 * вернуть. Серверная `delete_operation` удаляет строку по прежним правилам
 * (ручная, не перевод, без инвойса; права — политики удаления) и кладёт её
 * снимок в ящик. Ноль строк — отказ с текстом, а не тихий успех.
 */
export async function deleteTransaction(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("delete_operation", { p_id: id });
  if (error && isNotFound(error)) {
    // «Не найдена» после повтора — не отказ: прошлая попытка дошла до сервера,
    // а ответ потерялся (таймаут). Если строки в журнале больше нет, она
    // удалена — цель достигнута. Есть, но удалению закрыта (инвойс) — отказ.
    const { data: still, error: readError } = await supabase
      .from("finance_transactions")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!readError && !still) return;
  }
  if (error || !data) {
    throw new Error(
      error?.message || "Операция недоступна или связана с инвойсом",
    );
  }
}

/** Серверная «не найдена»: `raise exception … errcode 'P0002'`. */
function isNotFound(error: { code?: string; hint?: string | null }): boolean {
  return error.code === "P0002" || (error.hint ?? "").includes("operation:not_found");
}
