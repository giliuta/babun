// Accounts repository — STORY: finance redesign.
//
// One row per money bucket (cash / card / bank / other). Two scopes:
// 'team' accounts belong to exactly one brigade, 'company' accounts are
// shared and serve the teams listed in `account_teams` (surfaced here as
// Account.team_ids). Soft close via `is_active=false` keeps the history.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type {
  Account,
  AccountKind,
  AccountScope,
} from "../../local/finance/account";
import {
  accountWriteErrorMessage,
  duplicateAccountNameMessage,
  type DatabaseErrorLike,
} from "../../local/finance/integrity";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["accounts"]["Row"];

/**
 * Разбор ответа на запись по счёту.
 *
 * PostgREST на отказ RLS не ругается: невидимая политике строка просто не
 * находится, и `update`/`delete` отчитывается успехом с пустым телом. Отсюда
 * требование `.select("id")` у каждой записи — без него «удалили» и «не имеем
 * права» выглядят одинаково, экран схлопывается, а счёт остаётся.
 */
function assertAccountWritten(
  result: { data: { id: string } | null; error: DatabaseErrorLike | null },
  texts: { fallback: string; duplicate?: string },
): void {
  if (result.error) {
    throw new Error(accountWriteErrorMessage(result.error, texts));
  }
  if (!result.data) {
    throw new Error("Счёт не найден или недоступен — обновите список счетов");
  }
}

// Порядок строк задаёт только `position`, а до 2026-08-10 он писался нулём
// всем счетам: при равных значениях Postgres волен вернуть любой порядок, и
// список перетасовывался между рефетчами и устройствами. Имя сравниваем
// по-русски и без учёта регистра, id — последняя добивка ради детерминизма.
const accountOrder = new Intl.Collator("ru", { sensitivity: "base" });

function compareAccounts(a: Account, b: Account): number {
  return (
    a.position - b.position
    || accountOrder.compare(a.name, b.name)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

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
    vat_mode: (r.vat_mode as Account["vat_mode"]) ?? null,
    is_primary: r.is_primary,
    show_in_payments: r.show_in_payments,
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
  return ((data ?? []) as Row[])
    .map((r) => rowToAccount(r, teamsByAccount.get(r.id) ?? []))
    .sort(compareAccounts);
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
  /** Основной счёт группы. Ставить `true` СМЕНОЙ основного нельзя — уникальный
   *  частичный индекс отвергнет второй флаг в группе; для смены есть
   *  {@link setPrimaryAccount}, который сперва снимает старый. */
  is_primary?: boolean;
  /** Показывать ли счёт при оплате заявок. Новый счёт заводится принимающим:
   *  форма создания об этом не спрашивает, выключают потом в настройках. */
  show_in_payments?: boolean;
  /** Режим НДС этого счёта. null — как у команды/компании. */
  vat_mode?: "off" | "inclusive" | "exclusive" | null;
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
    throw new Error("У счёта нескольких команд не бывает команды-владельца");
  }
}

/**
 * Следующая позиция в пределах (тенант, команда) — счёт встаёт в конец своего
 * списка. У каждой команды нумерация своя, у счетов компании (brigade_id NULL)
 * — отдельная: список сгруппирован по командам, и сквозной счёт по тенанту
 * перемешивал бы соседние секции.
 *
 * Два устройства, создающие счёт одновременно, получат одну позицию — их
 * разведёт вторичный ключ сортировки, см. {@link compareAccounts}.
 */
async function nextAccountPosition(
  supabase: DbSupabase,
  tenantId: string,
  brigadeId: string | null,
): Promise<number> {
  const scoped = supabase
    .from("accounts")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1);
  const { data, error } = await (
    brigadeId === null
      ? scoped.is("brigade_id", null)
      : scoped.eq("brigade_id", brigadeId)
  ).maybeSingle();
  if (error) throw new Error(`nextAccountPosition: ${error.message}`);
  // Закрытые счета из нумерации не выпадают: их можно открыть обратно.
  return (data?.position ?? -1) + 1;
}

export async function insertAccount(
  supabase: DbSupabase,
  tenantId: string,
  draft: AccountDraft,
): Promise<Account> {
  assertOpeningBalance(draft.opening_balance);
  assertScopeConsistency(draft.scope, draft.brigade_id);
  const position = draft.position
    ?? (await nextAccountPosition(supabase, tenantId, draft.brigade_id));
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
      position,
      is_primary: draft.is_primary ?? false,
      show_in_payments: draft.show_in_payments ?? true,
      vat_mode: draft.vat_mode ?? null,
      is_active: true,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      accountWriteErrorMessage(error, {
        fallback: "Не удалось создать счёт",
        duplicate: duplicateAccountNameMessage(draft.name),
      }),
    );
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
  if (patch.is_primary !== undefined) update.is_primary = patch.is_primary;
  if (patch.show_in_payments !== undefined) {
    update.show_in_payments = patch.show_in_payments;
  }
  if (patch.vat_mode !== undefined) update.vat_mode = patch.vat_mode;
  const { data, error } = await supabase
    .from("accounts")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  assertAccountWritten({ data, error }, {
    fallback: "Не удалось изменить счёт",
    duplicate: patch.name
      ? duplicateAccountNameMessage(patch.name)
      : undefined,
  });
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
  if (error) {
    throw new Error(
      accountWriteErrorMessage(error, {
        fallback: "Не удалось прочитать команды счёта",
      }),
    );
  }
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
    if (addError) {
      throw new Error(
        accountWriteErrorMessage(addError, {
          fallback: "Не удалось подключить команду к счёту",
        }),
      );
    }
  }
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("account_teams")
      .delete()
      .eq("account_id", accountId)
      .in("team_id", toRemove);
    if (removeError) {
      throw new Error(
        accountWriteErrorMessage(removeError, {
          fallback: "Не удалось отключить команду от счёта",
        }),
      );
    }
  }
  return target;
}

/**
 * Назначить счёт основным для его группы (команды или счетов компании).
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН. Уникальный частичный индекс
 * `ux_accounts_primary_per_brigade` проверяется построчно, поэтому пометить
 * новый счёт, не сняв флаг со старого, физически нельзя — снимаем первым.
 * Обрыв между шагами оставляет группу без основного счёта: резолверы при этом
 * возвращаются к порядку строк (поведение до 2026-08-10), деньги никуда не
 * уезжают, а экран показывает ошибку.
 */
export async function setPrimaryAccount(
  supabase: DbSupabase,
  tenantId: string,
  account: Pick<Account, "id" | "brigade_id">,
): Promise<void> {
  const group = supabase
    .from("accounts")
    .update({ is_primary: false })
    .eq("tenant_id", tenantId)
    .eq("is_primary", true);
  const { error: clearError } = await (
    account.brigade_id === null
      ? group.is("brigade_id", null)
      : group.eq("brigade_id", account.brigade_id)
  );
  if (clearError) {
    throw new Error(
      accountWriteErrorMessage(clearError, {
        fallback: "Не удалось сменить основной счёт",
      }),
    );
  }
  const { data, error } = await supabase
    .from("accounts")
    .update({ is_primary: true })
    .eq("id", account.id)
    .select("id")
    .maybeSingle();
  assertAccountWritten({ data, error }, {
    fallback: "Не удалось сделать счёт основным",
  });
}

/**
 * Soft close — history kept, account hidden from active lists.
 *
 * Флаг «основной» снимается ТОЙ ЖЕ записью: иначе закрытый счёт продолжает
 * занимать единственное место в уникальном индексе, и назначить основным
 * другой счёт команды становится нельзя — вместо понятного отказа человек
 * получает нарушение уникальности.
 */
export async function softCloseAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ is_active: false, is_primary: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  assertAccountWritten({ data, error }, { fallback: "Не удалось закрыть счёт" });
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
  assertAccountWritten({ data, error }, { fallback: "Не удалось открыть счёт" });
}

/**
 * Удаление счёта, у которого нет истории (описка сразу после создания).
 *
 * Серверный триггер guard_account_delete_with_history отклоняет счёт с
 * операциями, чеками или оплатами заявок. До 2026-08-10 этого триггера НЕ БЫЛО,
 * а комментарий здесь обещал обратное: все ссылки стоят с `on delete set null`,
 * поэтому удаление молча обнуляло привязку — операции оставались в «Финансах»,
 * но пропадали из всех балансов.
 */
export async function deleteAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  assertAccountWritten({ data, error }, { fallback: "Не удалось удалить счёт" });
}

// Пикер «куда принять деньги» здесь НЕ живёт: у него свой RPC
// `list_payment_accounts_safe`, и единственный его потребитель — мобильный
// хук `features/appointments/payment-accounts.ts`. Второй, неиспользуемый
// разбор того же ответа лежал в этом файле и молча разъезжался с первым.
