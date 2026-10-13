// «Удалённые счета» and hard delete of an account without history.

import type { Account } from "../../../local/finance/account";
import {
  assertAccountWritten,
  rowToAccount,
  type DbSupabase,
  type Row,
} from "./rows";

/** «Удалённые счета» компании — новые сверху. */
export async function listDeletedAccounts(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(`listDeletedAccounts: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => rowToAccount(r));
}

/**
 * «УДАЛИТЬ» — В «УДАЛЁННЫЕ СЧЕТА» (владелец 03.10: «попадают в папку
 * „Удалённые счета" на 30 дней, как клиенты»). Время ставит сервер
 * (`account_trash_rules`): он же закрывает счёт, отказывает счёту с деньгами
 * и назначает срок стирания пустому.
 */
export async function trashAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  assertAccountWritten({ data, error }, { fallback: "Не удалось удалить счёт" });
}

/** Вернуть из «Удалённых счетов»: открытый счёт, срок снят (сервер). */
export async function restoreAccount(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  assertAccountWritten(
    { data, error },
    {
      fallback: "Не удалось вернуть счёт",
      duplicate: "В команде уже есть счёт с таким именем — переименуйте его и верните этот",
    },
  );
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
