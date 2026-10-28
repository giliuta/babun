// Client reads: paged lists, single-row get and the duplicate-phone probe.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type { Client } from "../../../local/clients";
import { rowToClient, type ClientRow } from "./mappers";

type DbSupabase = SupabaseClient<Database>;

// PostgREST installations commonly cap a response at 1000 rows. Client
// lists and tag assignments are long-lived CRM data, so a single unpaged
// select would make older customers (and some of their tags) disappear
// without returning an error.
export const CLIENT_PAGE_SIZE = 1000;

async function listClientRows(
  supabase: DbSupabase,
  tenantId: string,
  includeDeleted: boolean,
): Promise<ClientRow[]> {
  const rows: ClientRow[] = [];
  for (let offset = 0; ; offset += CLIENT_PAGE_SIZE) {
    let query = supabase
      .from("clients")
      .select("*")
      .eq("tenant_id", tenantId);
    if (!includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(offset, offset + CLIENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listClients: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE_SIZE) break;
  }
  return rows;
}

/** Порядок набора тегов — порядок выбора: первый тег главный (его имя на
 *  плитке клиента), поэтому строки идут по `position`. `tag_id` разводит
 *  равные места и держит страницы устойчивыми: без полного порядка строка
 *  на стыке страниц могла бы выпасть или повториться. */
async function listClientTagAssignments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<{ client_id: string; tag_id: string }[]> {
  const rows: { client_id: string; tag_id: string }[] = [];
  for (let offset = 0; ; offset += CLIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("client_tag_assignments")
      .select("client_id, tag_id")
      .eq("tenant_id", tenantId)
      .order("client_id", { ascending: true })
      .order("position", { ascending: true })
      .order("tag_id", { ascending: true })
      .range(offset, offset + CLIENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listClients tags: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE_SIZE) break;
  }
  return rows;
}

async function listClientsAndRows(
  supabase: DbSupabase,
  tenantId: string,
  includeDeleted: boolean,
): Promise<{ rows: ClientRow[]; clients: Client[] }> {
  const [rows, assigns] = await Promise.all([
    listClientRows(supabase, tenantId, includeDeleted),
    listClientTagAssignments(supabase, tenantId),
  ]);

  const tagsByClient = new Map<string, string[]>();
  for (const a of assigns) {
    const arr = tagsByClient.get(a.client_id) ?? [];
    arr.push(a.tag_id);
    tagsByClient.set(a.client_id, arr);
  }

  const clients = rows.map((r) => ({
    ...rowToClient(r),
    tag_ids: tagsByClient.get(r.id) ?? [],
  }));
  return { rows, clients };
}

export async function listClients(
  supabase: DbSupabase,
  tenantId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Client[]> {
  return (await listClientsAndRows(supabase, tenantId, !!options.includeDeleted)).clients;
}

/** Клиенты и их `updated_at` — из ОДНИХ И ТЕХ ЖЕ строк. Кэшу
 *  штамп нужен для сторожа правок. Отдельным вторым запросом он мог приехать
 *  НОВЕЕ данных — правка между запросами давала старые заметки с новым
 *  штампом, и следующая правка из очереди проходила сторож и тихо затирала
 *  чужую заметку, без всякого «Конфликта». */
export async function listClientsWithStamps(
  supabase: DbSupabase,
  tenantId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{ clients: Client[]; updatedAtById: Map<string, string> }> {
  const { rows, clients } = await listClientsAndRows(
    supabase,
    tenantId,
    !!options.includeDeleted,
  );
  const updatedAtById = new Map<string, string>();
  for (const r of rows) {
    if (r.updated_at) updatedAtById.set(r.id, r.updated_at);
  }
  return { clients, updatedAtById };
}

export async function getClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<Client | null> {
  const { data: row, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  if (!row) return null;

  const { data: assigns, error: assignErr } = await supabase
    .from("client_tag_assignments")
    .select("tag_id")
    .eq("client_id", id)
    .eq("tenant_id", tenantId)
    // Первый тег набора — главный: порядок мест, а не случайный порядок строк.
    .order("position", { ascending: true })
    .order("tag_id", { ascending: true });
  if (assignErr) throw new Error(`getClient tags: ${assignErr.message}`);

  return {
    ...rowToClient(row),
    tag_ids: (assigns ?? []).map((a) => a.tag_id),
  };
}

// ─── Duplicate guard (clients-99 F1.5) ─────────────────────────

export async function findClientByPhoneE164(
  supabase: DbSupabase,
  phoneE164: string,
  tenantId: string,
): Promise<Client | null> {
  if (!phoneE164) return null;
  const { data: row, error } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("phone_e164", phoneE164)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`findClientByPhoneE164: ${error.message}`);
  if (row) return { ...rowToClient(row), tag_ids: [] };
  // СТАРЫЕ КАРТОЧКИ БЕЗ phone_e164 (заведены до появления колонки). Их не видит
  // ни это сравнение, ни UNIQUE-индекс — так в базу и прошёл второй «Артем»
  // на том же номере (дубль не даём сдать). Таких строк
  // единицы: читаем их и сверяем хвост номера в 8 цифр — тот же ключ, что у
  // слияния и плашки дубля.
  const tail = phoneE164.replace(/\D/g, "").slice(-8);
  if (tail.length < 8) return null;
  const { data: legacy, error: legacyError } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("phone_e164", null)
    .is("deleted_at", null)
    .neq("phone", "");
  if (legacyError) throw new Error(`findClientByPhoneE164: ${legacyError.message}`);
  const hit = (legacy ?? []).find(
    (r) => (r.phone ?? "").replace(/\D/g, "").slice(-8) === tail,
  );
  return hit ? { ...rowToClient(hit), tag_ids: [] } : null;
}
