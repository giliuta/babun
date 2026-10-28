import type { Client } from "@babun/shared/local/clients";
import { clientToUpdate } from "@babun/shared/db/repositories/clients";
import { supabase } from "@/lib/supabase";

// СЛИЯНИЕ ДУБЛЯ — ОДНИМ ВЫЗОВОМ СЕРВЕРА (`merge_clients`).
//
// Правка основной, визиты, снимки «Удалённых записей», файлы, долги,
// напоминания, SMS и дубль в корзину — одна транзакция: обрыв посреди шагов
// больше не оставляет полуслияния, а дубль не уносит с собой файлы и долги
// через 30 дней. Патч и переезд объектов считает телефон (`merge-clients.ts`,
// там же тесты), сервер их только применяет.

type MergeRpc = {
  rpc: (
    name: "merge_clients",
    args: {
      p_primary: string;
      p_duplicate: string;
      p_patch: Record<string, unknown>;
      p_tag_ids: string[] | null;
      p_location_remap: Record<string, string>;
    },
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string; hint?: string } | null;
  }>;
};

/** Слить дубля в основную. Отказ сервера — ошибка словами человека. */
export async function mergeClientsOnServer(input: {
  primaryId: string;
  duplicateId: string;
  patch: Partial<Client>;
  remap: ReadonlyMap<string, string>;
}): Promise<void> {
  const { tag_ids: tagIds, ...fields } = input.patch;
  const rpc = supabase as unknown as MergeRpc;
  const { error } = await rpc.rpc("merge_clients", {
    p_primary: input.primaryId,
    p_duplicate: input.duplicateId,
    p_patch: clientToUpdate(fields) as Record<string, unknown>,
    p_tag_ids: tagIds ?? null,
    p_location_remap: Object.fromEntries(input.remap),
  });
  if (error) throw new Error(mergeRefusal(error));
}

/** Отказ сервера словами человека. */
export function mergeRefusal(error: { message: string; code?: string; hint?: string }): string {
  if (error.hint === "merge:paid_visits") {
    return "У дубля есть оплаченные записи — клиента у них не сменить, пока оплата не возвращена. Объединить пока нельзя";
  }
  if (error.code === "42501") return "Объединять карточки может только владелец";
  if (error.code === "P0002") return "Одна из карточек уже удалена — обновите страницу";
  return "Не удалось объединить";
}
