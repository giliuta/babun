// Accounts repository — STORY: finance redesign.
//
// One row per money bucket (cash / card / bank / other). Strictly
// per-brigade — the «общая Карта компании» on the design mockup is two
// distinct rows in the DB (one per brigade) sharing the same physical
// bank card. Soft close via `is_active=false` so the history stays.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type { Account, AccountKind } from "../../local/finance/account";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["accounts"]["Row"];

function rowToAccount(r: Row): Account {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    brigade_id: r.brigade_id,
    name: r.name,
    kind: r.kind as AccountKind,
    owner_master_id: r.owner_master_id,
    opening_balance: Number(r.opening_balance ?? 0),
    icon: r.icon,
    color: r.color,
    position: r.position,
    is_active: r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listAccounts(
  supabase: DbSupabase,
  tenantId: string,
  options: { includeInactive?: boolean } = {},
): Promise<Account[]> {
  let q = supabase
    .from("accounts")
    .select("*")
    .eq("tenant_id", tenantId);
  if (!options.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("position", { ascending: true });
  if (error) throw new Error(`listAccounts: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToAccount);
}

export interface AccountDraft {
  brigade_id: string;
  name: string;
  kind: AccountKind;
  owner_master_id?: string | null;
  opening_balance?: number;
  icon?: string | null;
  color?: string | null;
  position?: number;
}

function assertOpeningBalance(amount: number | undefined): void {
  if (amount === undefined) return;
  if (
    exactMoneyAmountToCents(amount, {
      allowNegative: true,
      allowZero: true,
    }) == null
  ) {
    throw new Error(
      "Введите корректный начальный баланс и не больше двух знаков после запятой",
    );
  }
}

export async function insertAccount(
  supabase: DbSupabase,
  tenantId: string,
  draft: AccountDraft,
): Promise<Account> {
  assertOpeningBalance(draft.opening_balance);
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      tenant_id: tenantId,
      brigade_id: draft.brigade_id,
      name: draft.name,
      kind: draft.kind,
      owner_master_id: draft.owner_master_id ?? null,
      opening_balance: draft.opening_balance ?? 0,
      icon: draft.icon ?? null,
      color: draft.color ?? null,
      position: draft.position ?? 0,
      is_active: true,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось создать финансовый счёт");
  }
  return rowToAccount(data as Row);
}

export async function updateAccount(
  supabase: DbSupabase,
  id: string,
  patch: Partial<AccountDraft>,
): Promise<void> {
  assertOpeningBalance(patch.opening_balance);
  const update: Partial<Database["public"]["Tables"]["accounts"]["Update"]> = {};
  if (patch.brigade_id !== undefined) update.brigade_id = patch.brigade_id;
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.owner_master_id !== undefined) update.owner_master_id = patch.owner_master_id;
  if (patch.opening_balance !== undefined) update.opening_balance = patch.opening_balance;
  if (patch.icon !== undefined) update.icon = patch.icon;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.position !== undefined) update.position = patch.position;
  const { data, error } = await supabase
    .from("accounts")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Финансовый счёт не найден или недоступен");
  }
}

/** Soft close — history kept, account hidden from active lists. */
export async function softCloseAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Финансовый счёт не найден или недоступен");
  }
}
