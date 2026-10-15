// Row mapping, list order and the write-confirmation guard for accounts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type {
  Account,
  AccountKind,
  AccountScope,
} from "../../../local/finance/account";
import {
  accountWriteErrorMessage,
  type DatabaseErrorLike,
} from "../../../local/finance/integrity";

export type DbSupabase = SupabaseClient<Database>;
export type Row = Database["public"]["Tables"]["accounts"]["Row"];

/**
 * Разбор ответа на запись по счёту.
 *
 * PostgREST на отказ RLS не ругается: невидимая политике строка просто не
 * находится, и `update`/`delete` отчитывается успехом с пустым телом. Отсюда
 * требование `.select("id")` у каждой записи — без него «удалили» и «не имеем
 * права» выглядят одинаково, экран схлопывается, а счёт остаётся.
 */
export function assertAccountWritten(
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

// Порядок строк задаёт только `position`; при равных значениях (например,
// всем счетам нули) Postgres волен вернуть любой порядок, и
// список перетасовывался между рефетчами и устройствами. Имя сравниваем
// по-русски и без учёта регистра, id — последняя добивка ради детерминизма.
const accountOrder = new Intl.Collator("ru", { sensitivity: "base" });

export function compareAccounts(a: Account, b: Account): number {
  return (
    a.position - b.position
    || accountOrder.compare(a.name, b.name)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function rowToAccount(r: Row, teamIds: string[] = []): Account {
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
    is_hidden: r.is_hidden ?? false,
    note: r.note ?? null,
    deleted_at: r.deleted_at ?? null,
    purge_at: r.purge_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
