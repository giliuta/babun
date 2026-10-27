// Файлы компании в Storage — снос по префиксу и снос по списку путей.
//
// SQL файлы не стирает: `storage.protect_delete()` отбивает
// `delete from storage.objects` даже у postgres, а каскад по `tenants` уносит
// только строки. Поэтому снос идёт через Storage API сервисным ключом — он
// мимо политик, и «200 без удаления» (политика SELECT прячет сироту) здесь не
// случается.
//
// Каждый путь в этих бакетах начинается с id компании (`<tenant>/…`): так их
// кладут приложение и политики бакетов. Бакеты без политик (`avatars`,
// `client-avatars`, `invoices`, `order-photos`, `tenant-assets`) приложение не
// пишет — их здесь нет, и чужой формат пути они не принесут.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export const TENANT_BUCKETS = [
  "appointment-photos",
  "client-attachments",
  "partner-files",
  "receipts",
  "tenant-logos",
] as const;

const PAGE = 1000;
/** Сколько путей уходит одним `remove()` — предел Storage API. */
const REMOVE_CHUNK = 100;

/** Все пути под префиксом, с вложенными папками. В ответе `list()` папка —
 *  строка без `id`. */
async function listAll(
  service: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await service.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const path = `${prefix}/${row.name}`;
      if (row.id) paths.push(path);
      else paths.push(...(await listAll(service, bucket, path)));
    }
    if (rows.length < PAGE) return paths;
  }
}

/** Стереть пути одного бакета. Возвращает, сколько Storage подтвердил. */
export async function removePaths(
  service: SupabaseClient,
  bucket: string,
  paths: readonly string[],
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    const { data, error } = await service.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`remove ${bucket}: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/** Стереть все файлы компании во всех её бакетах. Зовётся ТОЛЬКО после того,
 *  как строки компании уже удалены: живой компании это стёрло бы фото записей. */
export async function purgeTenantStorage(
  service: SupabaseClient,
  tenantId: string,
): Promise<{ removed: number; failedBuckets: string[] }> {
  let removed = 0;
  const failedBuckets: string[] = [];
  for (const bucket of TENANT_BUCKETS) {
    try {
      removed += await removePaths(service, bucket, await listAll(service, bucket, tenantId));
    } catch (error) {
      // Один бакет не дал — остальные всё равно чистим. Остаток подберёт
      // ночной `storage-janitor` (правило «компании нет»).
      console.error("tenant storage purge failed", {
        tenantId,
        bucket,
        message: error instanceof Error ? error.message : String(error),
      });
      failedBuckets.push(bucket);
    }
  }
  return { removed, failedBuckets };
}

/** Компании, где человек — владелец. Снимается ДО каскада удаления аккаунта:
 *  после него членства уже нет. Ошибка чтения — пусто, файлы тогда подберёт
 *  ночной `storage-janitor`. */
export async function ownedTenants(service: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "owner");
  if (error) {
    console.error("owned tenants read failed", { userId, code: error.code });
    return [];
  }
  return (data ?? []).map((row) => String(row.tenant_id));
}

/** Стереть файлы тех компаний, чьих строк больше нет. Компания с другим
 *  владельцем пережила удаление аккаунта — её файлы не трогаем. */
export async function purgeGoneTenantsStorage(
  service: SupabaseClient,
  tenantIds: readonly string[],
): Promise<void> {
  if (tenantIds.length === 0) return;
  const { data, error } = await service.from("tenants").select("id").in("id", [...tenantIds]);
  if (error) {
    console.error("surviving tenants read failed", { code: error.code });
    return;
  }
  const alive = new Set((data ?? []).map((row) => String(row.id)));
  for (const tenantId of tenantIds) {
    if (alive.has(tenantId)) continue;
    const { removed, failedBuckets } = await purgeTenantStorage(service, tenantId);
    console.log("tenant storage purged", { tenantId, removed, failedBuckets });
  }
}
