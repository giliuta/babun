import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@babun/shared/db/database.types";
import {
  getCalendarSettings,
  getOperationalCalendarSettings,
} from "@babun/shared/db/repositories/calendar-settings";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import type { UserRole } from "./role-policy";

// ЧТЕНИЯ БЕЗ ПОБОЧНЫХ ЭФФЕКТОВ — ДЛЯ ПРОГРЕВА ЧУЖОЙ КОМПАНИИ.
//
// Хуки `useTenant` и `useCalendarSettings` читали профиль и настройки и ТУТ
// ЖЕ, внутри queryFn, делали два побочных действия: выставляли валюту
// форматтеров (`setDefaultCurrency`) и писали настройки в MMKV. Для активной
// компании это правильно и момент верный — валюта ставится, когда пришёл
// профиль. Но прогрев компании B через те же функции выставил бы ВАЛЮТУ B
// экрану A и записал бы НАСТРОЙКИ B под общий ключ — это и есть протечка,
// только через удобство, а не через данные.
//
// Поэтому сами чтения вынесены сюда чистыми, а побочные действия остались в
// хуках — они выполняются только для активной компании. Условие сессии 005
// при передаче файлов: «вынос побочных эффектов — это смысл, нужен тест в
// обе стороны». Обе стороны: `company-fetchers.test.ts`.

type DbSupabase = SupabaseClient<Database>;
export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];

/** Поля профиля, которые безопасная проекция может не отдать; экран не должен
 *  падать на `undefined`. Взято ДОСЛОВНО из прежнего `tenant.ts`: значения
 *  обязаны совпадать с дефолтами самой таблицы (см. комментарии внутри). */
const TENANT_SAFE_DEFAULTS: Tenant = {
  id: "",
  name: "",
  address: null,
  bank_name: null,
  booking_slug: null,
  business_address: null,
  city: null,
  contact_email: null,
  contact_instagram: null,
  contact_phone: null,
  contact_telegram: null,
  contact_whatsapp: null,
  country: "",
  created_at: "",
  currency: "",
  current_period_end: null,
  iban: null,
  invoice_prefix: "",
  invoice_number_padding: 3,
  invoice_number_yearly_reset: true,
  invoice_next_number: null,
  // Генератор счетов: ровно те значения, что стоят дефолтами в самой таблице —
  // экран настроек и база обязаны говорить одно и то же на пустом кэше.
  invoice_due_days: 7,
  invoice_line_source: "services",
  invoice_default_line_title: "Услуги",
  invoice_footer_note: null,
  legal_name: null,
  logo_url: null,
  onboarded_at: null,
  personal_calendar_enabled: false,
  // НДС: по умолчанию выключен — бизнес без налога не должен видеть его нигде.
  vat_mode: "off",
  vat_rate: 0,
  vat_exemption_note: null,
  document_language: "en",
  plan: "",
  plan_override: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_status: null,
  track_units: true,
  trial_ends_at: null,
  vat_number: null,
  vertical: null,
};

export function parseTenantProfile(value: Json | null): Tenant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Профиль компании недоступен");
  }
  const row = value as Record<string, Json | undefined>;
  if (typeof row.id !== "string" || typeof row.name !== "string") {
    throw new Error("Сервер вернул некорректный профиль компании");
  }
  return {
    ...TENANT_SAFE_DEFAULTS,
    ...(row as unknown as Partial<Tenant>),
    id: row.id,
    name: row.name,
  };
}

export function isMissingSafeTenantRpc(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "PGRST202" ||
    /could not find the function.*current_tenant_profile_safe/i.test(
      error.message ?? "",
    )
  );
}

async function readTenantProfileFallback(
  client: DbSupabase,
  tenantId: string,
  role: UserRole,
): Promise<Tenant> {
  // Older deployed databases do not have the safe projection RPC yet. An
  // owner may read the full RLS-scoped row (invoice creation needs legal
  // requisites). Operational users get an explicit column allow-list so an
  // old permissive tenant policy cannot leak billing or bank fields.
  if (role === "owner") {
    const { data, error } = await client
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return parseTenantProfile(data as unknown as Json | null);
  }
  const { data, error } = await client
    .from("tenants")
    .select(
      "id, name, vertical, city, country, address, logo_url, contact_phone, contact_email, contact_whatsapp, contact_telegram, contact_instagram, onboarded_at, personal_calendar_enabled, currency, created_at",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseTenantProfile(data as unknown as Json | null);
}

/** Профиль компании. ЧИСТО: валюту не трогает — это делает хук, и только для
 *  активной компании. */
export async function fetchTenantProfile(
  client: DbSupabase,
  tenantId: string,
  role: UserRole,
): Promise<Tenant> {
  const { data, error } = await client.rpc("current_tenant_profile_safe");
  if (error) {
    if (isMissingSafeTenantRpc(error)) {
      return readTenantProfileFallback(client, tenantId, role);
    }
    throw new Error(error.message);
  }
  return parseTenantProfile(data);
}

/** Настройки календаря. ЧИСТО: в MMKV не пишет — это делает хук, и только для
 *  активной компании. Бросает при ошибке сети: запасной путь через кэш тоже у
 *  хука, прогреву он не нужен. */
export async function fetchCalendarSettings(
  client: DbSupabase,
  tenantId: string,
  role: UserRole,
): Promise<CalendarSettings> {
  if (role === "master") {
    return { ...(await getOperationalCalendarSettings(client)) };
  }
  return getCalendarSettings(client, tenantId);
}
