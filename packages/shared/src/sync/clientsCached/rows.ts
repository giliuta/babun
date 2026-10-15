// Client row builders: the cache (domain) projection and the queue
// (raw DB column) projection.

import type { Client } from "../../local/clients";
import type { CachedClient, CachedClientData } from "../../db/cache/sql";
import { toJson } from "../../db/json";

// Cache row → domain. The cache stores the full domain object decorated
// with tenant_id + updated_at; strip those two bookkeeping keys and return
// a clean `Client` (identical to what the repo list returns).
export function rowToClient(r: CachedClientData): Client {
  const { tenant_id: _t, updated_at: _u, ...client } = r;
  void _t;
  void _u;
  return client;
}

/** Build the DOMAIN cache row (what lands in `data`) from a canonical
 *  `Client`. Carries tag_ids + nested fields verbatim + the two
 *  bookkeeping keys. */
export function makeCachedRow(
  client: Client,
  tenantId: string,
  updatedAt: string | undefined,
): CachedClientData {
  return {
    ...client,
    tenant_id: tenantId,
    updated_at: updatedAt ?? new Date().toISOString(),
  };
}

/** Domain view of a cached row (drops the bookkeeping keys), or an empty
 *  patch base when the row wasn't cached. Used to build the optimistic
 *  return shape without leaking tenant_id/updated_at into the Client. */
export function toDomain(existing: CachedClientData | null): Partial<Client> {
  return existing ? rowToClient(existing) : {};
}

/** `created_by` is left out on purpose: the column default `auth.uid()`
 *  stamps the creator, and an explicit NULL would override it. */
export function makeServerRow(
  input: Client,
  tenantId: string,
  id: string,
  nowIso: string,
): Omit<CachedClient, "created_by"> {
  // RAW DB-column projection for the queue payload the replayer INSERTs.
  // Fill required Row columns with safe defaults matching the DB schema;
  // NO tag_ids here (that's a junction table, written online by the repo).
  return {
    id,
    tenant_id: tenantId,
    full_name: input.full_name ?? "",
    phone: input.phone ?? "",
    // STORY-085 — те же поля, что у онлайн-записи (`clientToInsert`): офлайн-
    // очередь, забывшая поле, стирает его при повторной отправке.
    legal_name: input.legal_name ?? null,
    vat_number: input.vat_number ?? null,
    reg_number: input.reg_number ?? null,
    billing_address: input.billing_address ?? null,
    // Наборы реквизитов — целым массивом, как связи ниже.
    requisites: toJson(input.requisites ?? []),
    // Связи едут целым массивом: третий ключ `location_id` (STORY-086) внутри
    // jsonb, перечислять ключи здесь нельзя — забытый ключ офлайн-очередь
    // стёрла бы при отправке, а перечень пришлось бы держать в двух местах.
    memberships: toJson(input.memberships ?? []),
    whatsapp_phone: input.whatsapp_phone ?? "",
    email: input.email ?? "",
    sms_name: input.sms_name ?? "",
    telegram_username: input.telegram_username ?? "",
    instagram_username: input.instagram_username ?? "",
    balance: input.balance ?? 0,
    discount: input.discount ?? 0,
    comment: input.comment ?? "",
    acquisition_source: input.acquisition_source ?? "unknown",
    referred_by_client_id: input.referred_by_client_id ?? null,
    first_contact_date: input.first_contact_date ?? null,
    address: input.address ?? "",
    city: input.city ?? "",
    city_manual: input.city_manual ?? false,
    // Колонка в базе осталась (данные не трогаем), но продукт язык клиента
    // больше не ведёт: переводы уедут в SMS-рассылки. Для NOT NULL-строки шлём пустую.
    language: "",
    property_type: input.property_type ?? "",
    birthday: input.birthday ?? "",
    blacklisted: input.blacklisted ?? false,
    // Отказ от SMS правится своей функцией базы; новый клиент его не несёт.
    sms_opt_out: input.sms_opt_out ?? false,
    pinned_at: input.pinned_at ?? null,
    reminder_at: input.reminder_at ?? null,
    phones: toJson(input.phones ?? []),
    locations: toJson(input.locations ?? []),
    notes: toJson(input.notes ?? []),
    equipment: toJson(input.equipment ?? []),
    phone_e164: input.phone_e164 ?? null,
    avatar_url: input.avatar_url ?? null,
    deleted_at: input.deleted_at ?? null,
    purge_at: input.purge_at ?? null,
    favorite_master_id: input.favorite_master_id ?? null,
    // Команда клиента: прямой офлайн-INSERT умолчания сервера не
    // знает, поэтому форма всегда присылает команду сама.
    team_id: input.team_id ?? null,
    created_at: input.created_at ?? nowIso,
    updated_at: nowIso,
  };
}
