// Accounts repository — STORY: finance redesign.
//
// One row per money bucket (cash / card / bank / other). Two scopes:
// 'team' accounts belong to exactly one brigade, 'company' accounts are
// shared and serve the teams listed in `account_teams` (surfaced here as
// Account.team_ids). Soft close via `is_active=false` keeps the history.

import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type { Account, AccountKind } from "../../local/finance/account";
import {
  accountWriteErrorMessage,
  duplicateAccountNameMessage,
} from "../../local/finance/integrity";
import {
  assertAccountWritten,
  compareAccounts,
  rowToAccount,
  type DbSupabase,
  type Row,
} from "./accounts/rows";

export {
  deleteAccount,
  listDeletedAccounts,
  restoreAccount,
  trashAccount,
} from "./accounts/trash";

export async function listAccounts(
  supabase: DbSupabase,
  tenantId: string,
  options: {
    includeInactive?: boolean;
    /** Счета из «Удалённых счетов» — только для подписей истории (лента,
     *  выгрузка, выписка): у операции на удалённом счёте имя счёта не
     *  пропадает. Пикеры и списки их не берут. */
    includeDeleted?: boolean;
  } = {},
): Promise<Account[]> {
  let q = supabase
    .from("accounts")
    .select("*")
    .eq("tenant_id", tenantId);
  if (!options.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("position", { ascending: true });
  if (error) throw new Error(`listAccounts: ${error.message}`);
  // «УДАЛЁННЫЕ СЧЕТА» В ОБЫЧНЫХ СПИСКАХ НЕ ЖИВУТ. Отсев —
  // здесь, по полю строки, а не фильтром запроса: так список не падает и на
  // базе, где колонки `deleted_at` ещё нет.
  const rows = ((data ?? []) as Row[]).filter((r) => options.includeDeleted || !r.deleted_at);

  // ПРИВЯЗКИ ЧИТАЕМ, ТОЛЬКО ЕСЛИ ЕСТЬ КОМУ. `account_teams` — историческая
  // таблица общего счёта: схема «счёт принадлежит ОДНОЙ команде» её отменила,
  // и живой продукт её не пишет
  // (`20260815150000_accounts_belong_to_one_team.sql`). Второй сетевой запрос
  // всё равно уходил на КАЖДОЕ открытие счетов и возвращал пусто: в базе ноль
  // строк и ноль счетов со `scope = 'company'`.
  // Легаси-строки при этом не теряются: у счёта такого охвата запрос по-прежнему
  // выполняется.
  const teamsByAccount = new Map<string, string[]>();
  if (rows.some((r) => r.scope === "company")) {
    const memberships = await supabase
      .from("account_teams")
      .select("account_id, team_id")
      .eq("tenant_id", tenantId);
    if (memberships.error) {
      throw new Error(`listAccounts: ${memberships.error.message}`);
    }
    for (const m of memberships.data ?? []) {
      const list = teamsByAccount.get(m.account_id);
      if (list) list.push(m.team_id);
      else teamsByAccount.set(m.account_id, [m.team_id]);
    }
  }
  return rows
    .map((r) => rowToAccount(r, teamsByAccount.get(r.id) ?? []))
    .sort(compareAccounts);
}

export interface AccountDraft {
  /** Always "team": the database CHECK rejects anything else. */
  scope: "team";
  /** Owning team. NOT NULL in the database. */
  brigade_id: string;
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
  vat_mode?: "off" | "inclusive" | "exclusive" | "on" | null;
  /** Скрытый счёт (только владелец): прятать — вместе с
   *  `show_in_payments: false`, иначе база откажет. */
  is_hidden?: boolean;
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

function assertAccountTeam(brigadeId: string): void {
  if (!brigadeId) throw new Error("Выберите команду счёта");
}

/**
 * Следующая позиция в пределах (тенант, команда) — счёт встаёт в конец своего
 * списка. У каждой команды нумерация своя: список сгруппирован по командам, и
 * сквозной счёт по тенанту перемешивал бы соседние секции.
 *
 * Два устройства, создающие счёт одновременно, получат одну позицию — их
 * разведёт вторичный ключ сортировки, см. {@link compareAccounts}.
 */
async function nextAccountPosition(
  supabase: DbSupabase,
  tenantId: string,
  brigadeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("accounts")
    .select("position")
    .eq("tenant_id", tenantId)
    .eq("brigade_id", brigadeId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
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
  assertAccountTeam(draft.brigade_id);
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
  return rowToAccount(data as Row);
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
  if (patch.is_hidden !== undefined) update.is_hidden = patch.is_hidden;
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
 * Назначить счёт основным для его группы (команды или счетов компании).
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН. Уникальный частичный индекс
 * `ux_accounts_primary_per_brigade` проверяется построчно, поэтому пометить
 * новый счёт, не сняв флаг со старого, физически нельзя — снимаем первым.
 * Обрыв между шагами оставляет группу без основного счёта: резолверы при этом
 * возвращаются к порядку строк, деньги никуда не
 * уезжают, а экран показывает ошибку.
 */
async function setPrimaryAccount(
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

// Пикер «куда принять деньги» здесь НЕ живёт: у него свой RPC
// `list_payment_accounts_safe`, и единственный его потребитель — мобильный
// хук `features/appointments/payment-accounts.ts`. Второй, неиспользуемый
// разбор того же ответа лежал в этом файле и молча разъезжался с первым.
