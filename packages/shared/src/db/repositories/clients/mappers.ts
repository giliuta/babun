// Column <-> field mappers between the `clients` row and the `Client`
// domain shape — the one place that knows that mapping.

import type { Database, Json } from "../../database.types";
import type {
  ACUnit,
  Client,
  ClientSourceValue,
  ClientMembership,
  ClientRequisites,
  ClientNote,
  Location,
  PhoneEntry,
  PropertyType,
} from "../../../local/clients";
import { toJson } from "../../json";

export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
export type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

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

export function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    full_name: r.full_name,
    phone: r.phone,
    // STORY-085: реквизиты клиента для инвойса и люди клиента.
    legal_name: r.legal_name ?? null,
    vat_number: r.vat_number ?? null,
    reg_number: r.reg_number ?? null,
    billing_address: r.billing_address ?? null,
    // Наборы реквизитов — перечислением полей, как связи ниже: чужой ключ в
    // домен не проходит. Строка старше миграции ключа не знает — пусто, и
    // читатель берёт четыре колонки (`clientRequisitesOf`).
    requisites: asArray<ClientRequisites>(r.requisites).map((set) => ({
      id: set.id,
      legal_name: set.legal_name ?? null,
      vat_number: set.vat_number ?? null,
      reg_number: set.reg_number ?? null,
      billing_address: set.billing_address ?? null,
      is_default: set.is_default === true,
    })),
    // Связи — ПЕРЕЧИСЛЕНИЕМ полей, как объекты ниже: чужой ключ в домен не
    // проходит, а поле, забытое здесь, стёрлось бы первой же правкой связей.
    memberships: asArray<ClientMembership>(r.memberships).map((m) => ({
      group_id: m.group_id,
      role: m.role ?? "",
      // Место связи (STORY-086). Сервер отдаёт связь без места БЕЗ ключа
      // (`jsonb_strip_nulls` в триггере), строка до миграции не знает его
      // вовсе — а домен держит ОДНУ форму: ключ есть всегда, «места нет» это
      // null. Так писателю связей не приходится различать «ключа не было» и
      // «место сняли», и снятие места пишется значением, а не удалением ключа.
      location_id: m.location_id ?? null,
    })),
    whatsapp_phone: r.whatsapp_phone,
    email: r.email,
    sms_name: r.sms_name,
    // «Клиент просил не писать». Не читать поле нельзя: после перезапуска
    // карточка показала бы «Присылать SMS» включённым, хотя в базе запрет
    // стоит, а календарь и запись предлагали бы «Отправить от компании»,
    // которую сервер отклоняет.
    sms_opt_out: r.sms_opt_out === true,
    telegram_username: r.telegram_username,
    instagram_username: r.instagram_username,

    balance: Number(r.balance ?? 0),
    discount: r.discount ?? 0,
    comment: r.comment,

    acquisition_source: (r.acquisition_source ?? "unknown") as ClientSourceValue,
    referred_by_client_id: r.referred_by_client_id,
    first_contact_date: r.first_contact_date,

    address: r.address,
    city: r.city,
    city_manual: r.city_manual,
    property_type: (r.property_type ?? "") as PropertyType | "",

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
      // Части адреса — тот же закон, что и у полей ниже: не
      // перечислено здесь — стёрто первой же правкой объекта.
      addressParts:
        l.addressParts && typeof l.addressParts === "object"
          ? l.addressParts
          : undefined,
      mapUrl: l.mapUrl,
      // Поля ниже обязаны читаться, потому что запись пишет весь JSON целиком
      // (clientToUpdate: out.locations = patch.locations). Иначе любой patch
      // locations, построенный из прочитанного клиента, стёр бы их и в базе:
      // график ТО, введённый диспетчером, исчезал бы при первой же правке
      // объекта, а serviceDueState всегда возвращал бы null (нет
      // service_interval_months — нет графика), и блок «Обслуживание» молчал. Перечисление полей вместо спреда — намеренно
      // (не пускаем в домен мусор из JSON), поэтому новое поле объекта
      // ОБЯЗАНО быть дописано здесь же.
      property_type: l.property_type,
      isPrimary: l.isPrimary,
      note: l.note,
      equipment: asArray<ACUnit>(toJson(l.equipment)).map(rowToUnit),
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
    purge_at: r.purge_at ?? null,
    favorite_master_id: r.favorite_master_id ?? null,
    team_id: r.team_id ?? null,

    created_at: r.created_at,
  };
}

/** Client → INSERT row. Exported so the offline row (`makeServerRow` in
 *  sync/clientsCached.ts) can be checked against it in tests. */
export function clientToInsert(c: Client, tenantId: string): ClientInsert {
  return {
    id: c.id || undefined,
    tenant_id: tenantId,
    full_name: c.full_name,
    phone: c.phone ?? "",
    legal_name: c.legal_name ?? null,
    vat_number: c.vat_number ?? null,
    reg_number: c.reg_number ?? null,
    billing_address: c.billing_address ?? null,
    // Наборы реквизитов — только непустые, как связи: пустой массив в базе
    // и так по умолчанию, а сервер без миграции 20260922100000 отверг бы
    // незнакомый ключ у КАЖДОГО нового клиента.
    ...(c.requisites && c.requisites.length > 0
      ? { requisites: toJson(c.requisites) }
      : {}),
    // Пустой список не шлём: в базе он и так пустой по умолчанию.
    ...(c.memberships && c.memberships.length > 0
      ? { memberships: toJson(c.memberships) }
      : {}),
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

    birthday: c.birthday ?? "",
    blacklisted: c.blacklisted ?? false,
    pinned_at: c.pinned_at ?? null,
    reminder_at: c.reminder_at ?? null,

    phones: toJson(c.phones ?? []),
    locations: toJson(c.locations ?? []),
    notes: toJson(c.notes ?? []),
    equipment: toJson(c.equipment ?? []),

    phone_e164: c.phone_e164 ?? null,
    avatar_url: c.avatar_url ?? null,
    deleted_at: c.deleted_at ?? null,
    purge_at: c.purge_at ?? null,
    favorite_master_id: c.favorite_master_id ?? null,
    // Команда — только выбранная: пусто решает сервер (первая доступная).
    ...(c.team_id ? { team_id: c.team_id } : {}),

    // Preserve the moment the form was created. If empty (legacy or
    // hand-built objects) fall back to DB default `now()`.
    created_at: c.created_at || undefined,
    // updated_at: handled by trigger
  };
}

/** Client patch → UPDATE columns. The one mapper for online and queued
 *  (offline) edits alike. */
export function clientToUpdate(patch: Partial<Client>): ClientUpdate {
  const out: ClientUpdate = {};
  if (patch.full_name !== undefined) out.full_name = patch.full_name;
  if (patch.phone !== undefined) out.phone = patch.phone;
  if (patch.legal_name !== undefined) out.legal_name = patch.legal_name ?? null;
  if (patch.vat_number !== undefined) out.vat_number = patch.vat_number ?? null;
  if (patch.reg_number !== undefined) out.reg_number = patch.reg_number ?? null;
  if (patch.billing_address !== undefined) out.billing_address = patch.billing_address ?? null;
  if (patch.requisites !== undefined) out.requisites = toJson(patch.requisites);
  if (patch.memberships !== undefined) out.memberships = toJson(patch.memberships);
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
  if (patch.birthday !== undefined) out.birthday = patch.birthday;
  if (patch.blacklisted !== undefined) out.blacklisted = patch.blacklisted;
  if (patch.pinned_at !== undefined) out.pinned_at = patch.pinned_at;
  if (patch.reminder_at !== undefined) out.reminder_at = patch.reminder_at;
  if (patch.phones !== undefined) out.phones = toJson(patch.phones);
  if (patch.locations !== undefined) out.locations = toJson(patch.locations);
  if (patch.notes !== undefined) out.notes = toJson(patch.notes);
  if (patch.equipment !== undefined) out.equipment = toJson(patch.equipment);
  if (patch.phone_e164 !== undefined) out.phone_e164 = patch.phone_e164 ?? null;
  if (patch.avatar_url !== undefined) out.avatar_url = patch.avatar_url ?? null;
  if (patch.deleted_at !== undefined) out.deleted_at = patch.deleted_at ?? null;
  if (patch.purge_at !== undefined) out.purge_at = patch.purge_at ?? null;
  if (patch.favorite_master_id !== undefined) out.favorite_master_id = patch.favorite_master_id ?? null;
  return out;
}
