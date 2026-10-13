// Client writes: atomic create/update through RPC (with the rolling-deploy
// fallback), city rename cascade, delete, archive/trash and restore.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../database.types";
import { rpcArgs } from "../../rpc-args";
import type { Client } from "../../../local/clients";
import {
  clientToInsert,
  clientToUpdate,
  rowToClient,
  type ClientInsert,
  type ClientRow,
  type ClientUpdate,
} from "./mappers";
import {
  atomicClientTagsUnavailable,
  clientWriteError,
  isMissingClientWriteRpc,
} from "./errors";

type DbSupabase = SupabaseClient<Database>;

/** Ключи, которые атомарные RPC не принимают: идентичность строки, сторожок
 *  LWW и СРОК КОРЗИНЫ. `purge_at` — поле жизненного цикла удаления, его ставит
 *  только «Удалить»/«Восстановить» прямым UPDATE (см. ниже soft-delete), и
 *  белый список функций его не знает. Пока он уезжал в payload, СОЗДАНИЕ
 *  КЛИЕНТА падало на «client payload contains a protected or unknown field». */
function toClientWritePayload(
  value: ClientInsert | ClientUpdate,
): Json {
  const {
    id: _id,
    tenant_id: _tenantId,
    updated_at: _updatedAt,
    purge_at: _purgeAt,
    ...payload
  } = value;
  void _id;
  void _tenantId;
  void _updatedAt;
  void _purgeAt;
  return payload as Json;
}

function atomicWriteResultToClient(
  data: Json,
  operation: "createClient" | "updateClient",
): Client {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${operation}: atomic RPC returned an invalid client`);
  }
  const record = data as unknown as ClientRow & { tag_ids?: unknown };
  if (typeof record.id !== "string" || typeof record.full_name !== "string") {
    throw new Error(`${operation}: atomic RPC returned an invalid client`);
  }
  return {
    ...rowToClient(record),
    tag_ids: Array.isArray(record.tag_ids)
      ? record.tag_ids.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function createClient(
  supabase: DbSupabase,
  input: Client,
  tenantId: string,
): Promise<Client> {
  const insert = clientToInsert(input, tenantId);
  const desiredTagIds = [...new Set(input.tag_ids ?? [])];
  const { data: atomic, error: atomicError } = await supabase.rpc(
    "create_client_with_tags",
    rpcArgs<"create_client_with_tags">({
      p_tenant_id: tenantId,
      p_client_id: input.id || null,
      p_client: toClientWritePayload(insert),
      p_tag_ids: desiredTagIds,
    }),
  );
  if (!atomicError) {
    return atomicWriteResultToClient(atomic, "createClient");
  }
  if (!isMissingClientWriteRpc(atomicError, "create_client_with_tags")) {
    throw clientWriteError("createClient", atomicError);
  }

  // A rolling old schema can safely create an untagged client with one
  // INSERT. It cannot atomically create the aggregate when tags were chosen:
  // INSERT + junction writes may split on a network/RLS failure and leave a
  // client that the UI reported as unsaved. Fail before the first write; the
  // completed draft remains available for retry after migration _012 lands.
  if (desiredTagIds.length > 0) {
    throw atomicClientTagsUnavailable("create");
  }

  // Rolling deploy only: the old schema has no aggregate RPC yet. Keep the
  // single-write untagged path until PostgREST sees migration _012; semantic
  // RPC errors never reach this branch.
  const { data: row, error } = await supabase
    .from("clients")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw new Error(`createClient: ${error.message}`);

  if (desiredTagIds.length) {
    const rows = desiredTagIds.map((tag_id) => ({
      client_id: row.id,
      tag_id,
      tenant_id: tenantId,
    }));
    const { error: tagErr } = await supabase
      .from("client_tag_assignments")
      .insert(rows);
    if (tagErr) throw new Error(`createClient tags: ${tagErr.message}`);
  }

  return { ...rowToClient(row), tag_ids: desiredTagIds };
}

export async function updateClient(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Client>,
  tenantId: string,
): Promise<Client> {
  const update = clientToUpdate(patch);
  const desiredTagIds = patch.tag_ids === undefined
    ? undefined
    : [...new Set(patch.tag_ids)];
  const atomicArgs: Database["public"]["Functions"]["update_client_with_tags"]["Args"] = {
    p_tenant_id: tenantId,
    p_client_id: id,
    p_patch: toClientWritePayload(update),
    ...(desiredTagIds === undefined ? {} : { p_tag_ids: desiredTagIds }),
  };
  const { data: atomic, error: atomicError } = await supabase.rpc(
    "update_client_with_tags",
    atomicArgs,
  );
  if (!atomicError) {
    return atomicWriteResultToClient(atomic, "updateClient");
  }
  if (!isMissingClientWriteRpc(atomicError, "update_client_with_tags")) {
    throw clientWriteError("updateClient", atomicError);
  }
  // Updating ordinary client fields is still one safe server write on a
  // rolling schema. Any explicit tag replacement is a multi-table aggregate,
  // so refuse it before PATCH instead of risking a half-applied profile.
  if (desiredTagIds !== undefined) {
    throw atomicClientTagsUnavailable("update");
  }

  // Rolling deploy only; removed naturally once every environment has _012.
  const { data: row, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) throw new Error(`updateClient: ${error.message}`);

  // Tags untouched — re-read for completeness.
  const { data: assigns } = await supabase
    .from("client_tag_assignments")
    .select("tag_id")
    .eq("client_id", id)
    .eq("tenant_id", tenantId);
  return {
    ...rowToClient(row),
    tag_ids: (assigns ?? []).map((a) => a.tag_id),
  };
}

/** Каскад переименования метки библиотеки по клиентам — clients.city
 *  хранит имя строкой (как day_cities/teams.cities[]), поэтому rename в
 *  библиотеке обязан дойти и сюда, иначе метки клиентов тихо осиротеют.
 *  city_manual не трогаем: переименование не меняет авто/ручной режим. */
export async function renameClientCity(
  supabase: DbSupabase,
  tenantId: string,
  from: string,
  to: string,
): Promise<void> {
  const { error } = await supabase
    .from("clients")
    .update({ city: to })
    .eq("tenant_id", tenantId)
    .eq("city", from);
  if (error) throw new Error(`renameClientCity: ${error.message}`);
}

export async function deleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`deleteClient: ${error.message}`);
  if (data.id !== id) throw new Error("deleteClient: клиент не найден");
  // Junction rows cascade via FK.
}

// ─── Архив, корзина и возврат ──────────────────────────────────
//
// Оба состояния невидимости живут в одной строке клиента:
//   deleted_at есть, purge_at пуст  → АРХИВ (бессрочно)
//   deleted_at есть, purge_at стоит → КОРЗИНА (сотрётся в эту дату)
// Поэтому каждая запись задаёт ОБА поля: архивация «поднимает» клиента из
// корзины (срок снимается), удаление из архива — опускает.

/** Сколько корзина держит клиента, прежде чем стереть навсегда. Столько же
 *  держат «Недавно удалённые» в Фото на iPhone — привычка уже есть. */
export const TRASH_DAYS = 30;

/** Дата стирания для клиента, положенного в корзину сейчас. */
export function purgeDateFromNow(days = TRASH_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function softDeleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
  /** Дата полного стирания — клиент едет в КОРЗИНУ. Без неё это архив. */
  purgeAt: string | null = null,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString(), purge_at: purgeAt })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`softDeleteClient: ${error.message}`);
  if (data.id !== id) throw new Error("softDeleteClient: клиент не найден");
}

export async function restoreClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: null, purge_at: null })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  // Номер у клиента уникален среди живых (`clients_tenant_phone_e164_idx`):
  // пока этот лежал в «Удалённых», его номер мог достаться новому клиенту.
  // Говорим словами, а не «duplicate key value violates…» (аудит 03.10).
  if (error?.code === "23505") {
    throw new Error("Его номер уже у другого клиента — вернуть нельзя, пока номер занят");
  }
  if (error) throw new Error(`restoreClient: ${error.message}`);
  if (data.id !== id) throw new Error("restoreClient: клиент не найден");
}
