// Clients repository — STORY-036 / STORY-038.
//
// Single bridge between the UI shape (`@babun/shared/local/clients`
// → `Client`) and the Supabase row shape (`Database['public']
// ['Tables']['clients']['Row']`). Every nested array field on the
// local Client lives in jsonb on the DB; the adapters below are the
// only place that knows the column ↔ field mapping.
//
// Tag membership is stored in the `client_tag_assignments` junction
// table; the repository hides this from callers — `Client.tag_ids`
// round-trips losslessly via a parallel query.
//
// STORY-038 — every function in this file expects a Supabase client
// authenticated as either `anon` (no session) or `authenticated`
// (session cookie). RLS keys off public.current_tenant_id() which
// reads JWT app_metadata.tenant_id (with a tenants-by-owner_user_id
// fallback for the fresh-signup race). The explicit `.eq('tenant_id',
// tenantId)` filter below is now redundant for security but kept as
// belt-and-suspenders + helps PostgREST pick a faster index path.
// Service role bypass is intentionally out of scope; admin/cron
// tasks live outside this module (none yet).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import type {
  ACUnit,
  AcquisitionSource,
  Client,
  ClientNote,
  ClientTag,
  Location,
  PhoneEntry,
  PropertyType,
} from "../../local/clients";

type DbSupabase = SupabaseClient<Database>;
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type TagRow = Database["public"]["Tables"]["client_tags"]["Row"];

// PostgREST installations commonly cap a response at 1000 rows. Client
// lists and tag assignments are long-lived CRM data, so a single unpaged
// select would make older customers (and some of their tags) disappear
// without returning an error.
const CLIENT_PAGE_SIZE = 1000;

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

async function listClientTagAssignments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Array<{ client_id: string; tag_id: string }>> {
  const rows: Array<{ client_id: string; tag_id: string }> = [];
  for (let offset = 0; ; offset += CLIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("client_tag_assignments")
      .select("client_id, tag_id")
      .eq("tenant_id", tenantId)
      .order("client_id", { ascending: true })
      .order("tag_id", { ascending: true })
      .range(offset, offset + CLIENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listClients tags: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE_SIZE) break;
  }
  return rows;
}

async function listClientTagRows(
  supabase: DbSupabase,
  tenantId: string,
): Promise<TagRow[]> {
  const rows: TagRow[] = [];
  for (let offset = 0; ; offset += CLIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("client_tags")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + CLIENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listClientTags: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE_SIZE) break;
  }
  return rows;
}

// ─── Adapters ──────────────────────────────────────────────────

function asArray<T>(v: Json | null | undefined): T[] {
  return Array.isArray(v) ? (v as unknown as T[]) : [];
}

/** JSON-юнит → доменный ACUnit. Один маппер на оба места, где юниты живут
 *  (внутри объекта и легаси-массив на клиенте): расхождение между ними уже
 *  один раз стоило нам графика ТО. */
function rowToUnit(u: ACUnit): ACUnit {
  return {
    id: u.id,
    room: u.room,
    brand: u.brand,
    model: u.model,
    ac_type: u.ac_type ?? "split",
    has_indoor: u.has_indoor ?? true,
    has_outdoor: u.has_outdoor ?? true,
    // Расписание обслуживания — читаем, иначе запись его затирает.
    installed_at: u.installed_at,
    last_service_at: u.last_service_at,
    service_interval_months: u.service_interval_months,
  };
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    full_name: r.full_name,
    phone: r.phone,
    whatsapp_phone: r.whatsapp_phone,
    email: r.email,
    sms_name: r.sms_name,
    telegram_username: r.telegram_username,
    instagram_username: r.instagram_username,

    balance: Number(r.balance ?? 0),
    discount: r.discount ?? 0,
    comment: r.comment,

    acquisition_source: (r.acquisition_source ?? "unknown") as AcquisitionSource,
    referred_by_client_id: r.referred_by_client_id,
    first_contact_date: r.first_contact_date,

    address: r.address,
    city: r.city,
    city_manual: r.city_manual,
    property_type: (r.property_type ?? "") as PropertyType | "",

    language: r.language ?? "",
    birthday: r.birthday,
    blacklisted: r.blacklisted,
    pinned_at: r.pinned_at,
    reminder_at: r.reminder_at,

    phones: asArray<PhoneEntry>(r.phones).map((p) => ({
      id: p.id,
      number: p.number,
      label: p.label,
      name: p.name,
    })),
    locations: asArray<Location>(r.locations).map((l) => ({
      id: l.id,
      label: l.label,
      address: l.address,
      mapUrl: l.mapUrl,
      // P0 2026-07-26: поля ниже маппер РАНЬШЕ НЕ ЧИТАЛ, хотя запись пишет
      // весь JSON целиком (clientToUpdate: out.locations = patch.locations).
      // Значит любой patch locations, построенный из прочитанного клиента,
      // стирал их и в базе: график ТО, введённый диспетчером, исчезал при
      // первой же правке объекта, а serviceDueState всегда возвращал null
      // (нет service_interval_months — нет графика), из-за чего блок
      // «Обслуживание» молчал. Перечисление полей вместо спреда — намеренно
      // (не пускаем в домен мусор из JSON), поэтому новое поле объекта
      // ОБЯЗАНО быть дописано здесь же.
      property_type: l.property_type,
      isPrimary: l.isPrimary,
      note: l.note,
      equipment: asArray<ACUnit>(l.equipment as unknown as Json).map(rowToUnit),
    })),
    notes: asArray<ClientNote>(r.notes).map((n) => ({
      id: n.id,
      text: n.text,
      created_at: n.created_at,
    })),
    equipment: asArray<ACUnit>(r.equipment).map(rowToUnit),

    // Filled by parallel query against client_tag_assignments.
    tag_ids: [],

    phone_e164: r.phone_e164 ?? null,
    avatar_url: r.avatar_url ?? null,
    deleted_at: r.deleted_at ?? null,
    favorite_master_id: r.favorite_master_id ?? null,

    created_at: r.created_at,
  };
}

function clientToInsert(c: Client, tenantId: string): ClientInsert {
  return {
    id: c.id || undefined,
    tenant_id: tenantId,
    full_name: c.full_name,
    phone: c.phone ?? "",
    whatsapp_phone: c.whatsapp_phone ?? "",
    email: c.email ?? "",
    sms_name: c.sms_name ?? "",
    telegram_username: c.telegram_username ?? "",
    instagram_username: c.instagram_username ?? "",

    balance: c.balance ?? 0,
    discount: c.discount ?? 0,
    comment: c.comment ?? "",

    acquisition_source: c.acquisition_source ?? "unknown",
    referred_by_client_id: c.referred_by_client_id ?? null,
    first_contact_date: c.first_contact_date ?? null,

    address: c.address ?? "",
    city: c.city ?? "",
    city_manual: c.city_manual ?? false,
    property_type: c.property_type || "",

    language: c.language ?? null,
    birthday: c.birthday ?? "",
    blacklisted: c.blacklisted ?? false,
    pinned_at: c.pinned_at ?? null,
    reminder_at: c.reminder_at ?? null,

    phones: (c.phones ?? []) as unknown as Json,
    locations: (c.locations ?? []) as unknown as Json,
    notes: (c.notes ?? []) as unknown as Json,
    equipment: (c.equipment ?? []) as unknown as Json,

    phone_e164: c.phone_e164 ?? null,
    avatar_url: c.avatar_url ?? null,
    deleted_at: c.deleted_at ?? null,
    favorite_master_id: c.favorite_master_id ?? null,

    // Preserve the moment the form was created. If empty (legacy or
    // hand-built objects) fall back to DB default `now()`.
    created_at: c.created_at || undefined,
    // updated_at: handled by trigger
  };
}

function clientToUpdate(patch: Partial<Client>): ClientUpdate {
  const out: ClientUpdate = {};
  if (patch.full_name !== undefined) out.full_name = patch.full_name;
  if (patch.phone !== undefined) out.phone = patch.phone;
  if (patch.whatsapp_phone !== undefined) out.whatsapp_phone = patch.whatsapp_phone;
  if (patch.email !== undefined) out.email = patch.email;
  if (patch.sms_name !== undefined) out.sms_name = patch.sms_name;
  if (patch.telegram_username !== undefined) out.telegram_username = patch.telegram_username;
  if (patch.instagram_username !== undefined) out.instagram_username = patch.instagram_username;
  if (patch.balance !== undefined) out.balance = patch.balance;
  if (patch.discount !== undefined) out.discount = patch.discount;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (patch.acquisition_source !== undefined) out.acquisition_source = patch.acquisition_source;
  if (patch.referred_by_client_id !== undefined) out.referred_by_client_id = patch.referred_by_client_id;
  if (patch.first_contact_date !== undefined) out.first_contact_date = patch.first_contact_date;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.city_manual !== undefined) out.city_manual = patch.city_manual;
  if (patch.property_type !== undefined) out.property_type = patch.property_type || "";
  if (patch.language !== undefined) out.language = patch.language || null;
  if (patch.birthday !== undefined) out.birthday = patch.birthday;
  if (patch.blacklisted !== undefined) out.blacklisted = patch.blacklisted;
  if (patch.pinned_at !== undefined) out.pinned_at = patch.pinned_at;
  if (patch.reminder_at !== undefined) out.reminder_at = patch.reminder_at;
  if (patch.phones !== undefined) out.phones = patch.phones as unknown as Json;
  if (patch.locations !== undefined) out.locations = patch.locations as unknown as Json;
  if (patch.notes !== undefined) out.notes = patch.notes as unknown as Json;
  if (patch.equipment !== undefined) out.equipment = patch.equipment as unknown as Json;
  if (patch.phone_e164 !== undefined) out.phone_e164 = patch.phone_e164 ?? null;
  if (patch.avatar_url !== undefined) out.avatar_url = patch.avatar_url ?? null;
  if (patch.deleted_at !== undefined) out.deleted_at = patch.deleted_at ?? null;
  if (patch.favorite_master_id !== undefined) out.favorite_master_id = patch.favorite_master_id ?? null;
  return out;
}

type ClientWriteRpcName =
  | "create_client_with_tags"
  | "update_client_with_tags";

type PostgrestErrorLike = {
  code?: string;
  message?: string;
  status?: number;
  statusCode?: number;
};

/** Rolling deployment compatibility is deliberately narrow. Only a missing
 * RPC/schema-cache contract may use the legacy multi-request path; validation,
 * authorization and database errors must surface unchanged so callers never
 * turn a rejected atomic write into a partial one. */
function isMissingClientWriteRpc(
  error: PostgrestErrorLike,
  rpcName: ClientWriteRpcName,
): boolean {
  const message = error.message ?? "";
  const namesRequestedRpc = message.toLowerCase().includes(rpcName);
  if (!namesRequestedRpc) return false;
  return (
    error.code === "PGRST202"
    || (
      error.code === "42883"
      && /does not exist|undefined function/i.test(message)
    )
    || /could not find the function|schema cache/i.test(message)
  );
}

function clientWriteError(
  prefix: string,
  error: PostgrestErrorLike,
): Error {
  const wrapped = new Error(`${prefix}: ${error.message ?? "unknown error"}`);
  Object.assign(wrapped, {
    code: error.code,
    status: error.status,
    statusCode: error.statusCode,
  });
  return wrapped;
}

function atomicClientTagsUnavailable(operation: "create" | "update"): Error {
  const action = operation === "create" ? "создать клиента с тегами" : "изменить теги клиента";
  const error = new Error(
    `Сейчас нельзя безопасно ${action}: серверная схема ещё не обновлена. Остальные данные не изменены.`,
  );
  Object.assign(error, { code: "CLIENT_TAGS_ATOMIC_RPC_REQUIRED" });
  return error;
}

function toClientWritePayload(
  value: ClientInsert | ClientUpdate,
): Json {
  const {
    id: _id,
    tenant_id: _tenantId,
    updated_at: _updatedAt,
    ...payload
  } = value;
  void _id;
  void _tenantId;
  void _updatedAt;
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

// ─── Public API ────────────────────────────────────────────────

export async function listClients(
  supabase: DbSupabase,
  tenantId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Client[]> {
  const [rows, assigns] = await Promise.all([
    listClientRows(supabase, tenantId, !!options.includeDeleted),
    listClientTagAssignments(supabase, tenantId),
  ]);

  const tagsByClient = new Map<string, string[]>();
  for (const a of assigns) {
    const arr = tagsByClient.get(a.client_id) ?? [];
    arr.push(a.tag_id);
    tagsByClient.set(a.client_id, arr);
  }

  return rows.map((r) => ({
    ...rowToClient(r),
    tag_ids: tagsByClient.get(r.id) ?? [],
  }));
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
    .eq("tenant_id", tenantId);
  if (assignErr) throw new Error(`getClient tags: ${assignErr.message}`);

  return {
    ...rowToClient(row),
    tag_ids: (assigns ?? []).map((a) => a.tag_id),
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
    {
      p_tenant_id: tenantId,
      p_client_id: input.id || null,
      p_client: toClientWritePayload(insert),
      p_tag_ids: desiredTagIds,
    },
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

// ─── Soft-delete + restore (clients-99 F3.2) ───────────────────

export async function softDeleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`softDeleteClient: ${error.message}`);
  if (data.id !== id) throw new Error("softDeleteClient: клиент не найден");
}

export async function softDeleteClients(
  supabase: DbSupabase,
  ids: string[],
  tenantId: string,
): Promise<void> {
  if (!ids.length) return;
  const uniqueIds = [...new Set(ids)];
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", uniqueIds)
    .eq("tenant_id", tenantId)
    .select("id");
  if (error) throw new Error(`softDeleteClients: ${error.message}`);
  if ((data ?? []).length !== uniqueIds.length) {
    throw new Error("softDeleteClients: часть клиентов не найдена");
  }
}

export async function restoreClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`restoreClient: ${error.message}`);
  if (data.id !== id) throw new Error("restoreClient: клиент не найден");
}

export async function restoreClients(
  supabase: DbSupabase,
  ids: string[],
  tenantId: string,
): Promise<void> {
  if (!ids.length) return;
  const uniqueIds = [...new Set(ids)];
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: null })
    .in("id", uniqueIds)
    .eq("tenant_id", tenantId)
    .select("id");
  if (error) throw new Error(`restoreClients: ${error.message}`);
  if ((data ?? []).length !== uniqueIds.length) {
    throw new Error("restoreClients: часть клиентов не найдена");
  }
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
  if (!row) return null;
  return { ...rowToClient(row), tag_ids: [] };
}

// ─── Tag CRUD ──────────────────────────────────────────────────

function rowToTag(r: TagRow): ClientTag {
  return { id: r.id, name: r.name, color: r.color };
}

export async function listClientTags(
  supabase: DbSupabase,
  tenantId: string,
): Promise<ClientTag[]> {
  return (await listClientTagRows(supabase, tenantId)).map(rowToTag);
}

export async function createClientTag(
  supabase: DbSupabase,
  input: { id?: string; name: string; color: string },
  tenantId: string,
): Promise<ClientTag> {
  const { data, error } = await supabase
    .from("client_tags")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      tenant_id: tenantId,
      name: input.name,
      color: input.color,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createClientTag: ${error.message}`);
  return rowToTag(data);
}

export async function updateClientTag(
  supabase: DbSupabase,
  id: string,
  patch: { name?: string; color?: string },
  tenantId: string,
): Promise<ClientTag> {
  const { data, error } = await supabase
    .from("client_tags")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) throw new Error(`updateClientTag: ${error.message}`);
  return rowToTag(data);
}

export async function deleteClientTag(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("client_tags")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`deleteClientTag: ${error.message}`);
  if (data.id !== id) throw new Error("deleteClientTag: тег не найден");
}
