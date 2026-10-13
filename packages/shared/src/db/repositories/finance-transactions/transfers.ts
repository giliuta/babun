// Account-to-account transfers through owner-only idempotent RPCs.

import { rpcArgs } from "../../rpc-args";
import { randomUuid } from "../../../sync/uuid";
import type { FinanceTransaction } from "../../../local/finance/transaction";
import {
  assertPositiveMoneyAmount,
  rejectFutureLedgerDate,
  rowToTx,
  type DbSupabase,
  type Row,
} from "./shared";

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
