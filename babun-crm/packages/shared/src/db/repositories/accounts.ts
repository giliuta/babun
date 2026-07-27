// Accounts repository — STORY: finance redesign.
//
// One row per money bucket (cash / card / bank / other). Two scopes:
// 'team' accounts belong to exactly one brigade, 'company' accounts are
// shared and serve the teams listed in `account_teams` (surfaced here as
// Account.team_ids). Soft close via `is_active=false` keeps the history.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type {
  Account,
  AccountKind,
  AccountScope,
} from "../../local/finance/account";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["accounts"]["Row"];

function rowToAccount(r: Row, teamIds: string[] = []): Account {
  const scope = (r.scope as AccountScope) ?? "team";
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    scope,
    brigade_id: r.brigade_id,
    team_ids: scope === "company" ? teamIds : [],
    name: r.name,
    kind: r.kind as AccountKind,
    owner_master_id: r.owner_master_id,
    opening_balance: Number(r.opening_balance ?? 0),
    icon: r.icon,
    color: r.color,
    position: r.position,
    balance_hidden: r.balance_hidden,
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
  const [{ data, error }, memberships] = await Promise.all([
    q.order("position", { ascending: true }),
    supabase
      .from("account_teams")
      .select("account_id, team_id")
      .eq("tenant_id", tenantId),
  ]);
  if (error) throw new Error(`listAccounts: ${error.message}`);
  if (memberships.error) {
    throw new Error(`listAccounts: ${memberships.error.message}`);
  }
  const teamsByAccount = new Map<string, string[]>();
  for (const m of memberships.data ?? []) {
    const list = teamsByAccount.get(m.account_id);
    if (list) list.push(m.team_id);
    else teamsByAccount.set(m.account_id, [m.team_id]);
  }
  return ((data ?? []) as Row[]).map((r) =>
    rowToAccount(r, teamsByAccount.get(r.id) ?? []),
  );
}

export interface AccountDraft {
  scope: AccountScope;
  /** Required for scope === "team", must be null for "company". */
  brigade_id: string | null;
  /** Teams attached to a company account; ignored for scope === "team". */
  team_ids?: string[];
  name: string;
  kind: AccountKind;
  owner_master_id?: string | null;
  opening_balance?: number;
  icon?: string | null;
  color?: string | null;
  position?: number;
  balance_hidden?: boolean;
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

function assertScopeConsistency(
  scope: AccountScope,
  brigadeId: string | null,
): void {
  if (scope === "team" && !brigadeId) {
    throw new Error("Выберите команду счёта");
  }
  if (scope === "company" && brigadeId) {
    throw new Error("У общего счёта компании не бывает команды-владельца");
  }
}

export async function insertAccount(
  supabase: DbSupabase,
  tenantId: string,
  draft: AccountDraft,
): Promise<Account> {
  assertOpeningBalance(draft.opening_balance);
  assertScopeConsistency(draft.scope, draft.brigade_id);
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      tenant_id: tenantId,
      scope: draft.scope,
      brigade_id: draft.brigade_id,
      name: draft.name,
      kind: draft.kind,
      owner_master_id: draft.owner_master_id ?? null,
      opening_balance: draft.opening_balance ?? 0,
      icon: draft.icon ?? null,
      color: draft.color ?? null,
      position: draft.position ?? 0,
      balance_hidden: draft.balance_hidden ?? false,
      is_active: true,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось создать финансовый счёт");
  }
  const account = rowToAccount(data as Row);
  const teamIds = draft.scope === "company" ? (draft.team_ids ?? []) : [];
  if (teamIds.length === 0) return account;
  try {
    return {
      ...account,
      team_ids: await setAccountTeams(supabase, tenantId, account.id, teamIds),
    };
  } catch (attachError) {
    // A company account without its teams is unusable and invisible to
    // payment pickers — roll the fresh row back instead of leaving it.
    await supabase.from("accounts").delete().eq("id", account.id);
    throw attachError;
  }
}

export async function updateAccount(
  supabase: DbSupabase,
  id: string,
  patch: Partial<AccountDraft>,
): Promise<void> {
  assertOpeningBalance(patch.opening_balance);
  const update: Partial<Database["public"]["Tables"]["accounts"]["Update"]> = {};
  if (patch.scope !== undefined) update.scope = patch.scope;
  if (patch.brigade_id !== undefined) update.brigade_id = patch.brigade_id;
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.owner_master_id !== undefined) update.owner_master_id = patch.owner_master_id;
  if (patch.opening_balance !== undefined) update.opening_balance = patch.opening_balance;
  if (patch.icon !== undefined) update.icon = patch.icon;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.balance_hidden !== undefined) update.balance_hidden = patch.balance_hidden;
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

/**
 * Replace the team membership of a company account (diff-based: the
 * `account_teams` rows themselves are immutable). Returns the final list.
 */
export async function setAccountTeams(
  supabase: DbSupabase,
  tenantId: string,
  accountId: string,
  teamIds: string[],
): Promise<string[]> {
  const target = [...new Set(teamIds)];
  const { data, error } = await supabase
    .from("account_teams")
    .select("team_id")
    .eq("account_id", accountId);
  if (error) throw new Error(`setAccountTeams: ${error.message}`);
  const current = new Set((data ?? []).map((r) => r.team_id));
  const toAdd = target.filter((teamId) => !current.has(teamId));
  const toRemove = [...current].filter((teamId) => !target.includes(teamId));
  if (toAdd.length > 0) {
    const { error: addError } = await supabase.from("account_teams").insert(
      toAdd.map((teamId) => ({
        account_id: accountId,
        tenant_id: tenantId,
        team_id: teamId,
      })),
    );
    if (addError) throw new Error(`setAccountTeams: ${addError.message}`);
  }
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("account_teams")
      .delete()
      .eq("account_id", accountId)
      .in("team_id", toRemove);
    if (removeError) throw new Error(`setAccountTeams: ${removeError.message}`);
  }
  return target;
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

/** Reopen a soft-closed account (the reverse of {@link softCloseAccount}). */
export async function reopenAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ is_active: true })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Финансовый счёт не найден или недоступен");
  }
}

/**
 * Hard delete for an account without ledger history (a typo right after
 * creation). The server-side deletion guard rejects anything with rows.
 */
export async function deleteAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Slim account projection for payment surfaces — no balances by design. */
export interface PaymentAccount {
  id: string;
  name: string;
  kind: AccountKind;
  scope: AccountScope;
  icon: string | null;
  color: string | null;
  position: number;
}

/**
 * Accounts that can receive a payment for the given team: the team's own
 * accounts plus attached company accounts. SECURITY DEFINER on the server;
 * masters get names only — never balances.
 */
export async function listPaymentAccountsSafe(
  supabase: DbSupabase,
  teamId: string,
): Promise<PaymentAccount[]> {
  const { data, error } = await supabase.rpc("list_payment_accounts_safe", {
    p_team_id: teamId,
  });
  if (error) throw new Error(`listPaymentAccountsSafe: ${error.message}`);
  return ((data ?? []) as Json[]).map((raw) => {
    const r = raw as Record<string, Json>;
    return {
      id: String(r.id),
      name: String(r.name),
      kind: r.kind as AccountKind,
      scope: r.scope as AccountScope,
      icon: (r.icon as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      position: Number(r.position ?? 0),
    };
  });
}
