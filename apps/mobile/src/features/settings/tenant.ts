import { setDefaultCurrency } from "@babun/shared/common/utils/money";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { isUserRole, type UserRole } from "./role-policy";

export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];
type TenantUpdate = Database["public"]["Tables"]["tenants"]["Update"];

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

function parseTenantProfile(value: Json | null): Tenant {
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

function isMissingSafeTenantRpc(error: {
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
  tenantId: string,
  role: UserRole,
): Promise<Tenant> {
  // Older deployed databases do not have the safe projection RPC yet. An
  // owner may read the full RLS-scoped row (invoice creation needs legal
  // requisites). Operational users get an explicit column allow-list so an
  // old permissive tenant policy cannot leak billing or bank fields.
  if (role === "owner") {
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return parseTenantProfile(data as unknown as Json | null);
  }

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, vertical, city, country, address, logo_url, contact_phone, contact_email, contact_whatsapp, contact_telegram, contact_instagram, onboarded_at, personal_calendar_enabled, created_at",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseTenantProfile(data as unknown as Json | null);
}

export type { UserRole } from "./role-policy";

const ROLE_LOOKUP_TIMEOUT_MS = 6_000;

function withRoleLookupTimeout<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Не удалось проверить роль: сеть не отвечает")),
        ROLE_LOOKUP_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// Role of the signed-in user within the active tenant (tenant_members via
// the current_user_role() RPC from 20260430_008). RLS gates tenants UPDATE
// to owner only — screens use this to disable what would fail anyway.
export function useCurrentRole() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["current-role", tenantId],
    enabled: !!tenantId,
    // Security gates need a terminal result even on a cold offline start.
    // Default networkMode would park this query in pending/paused forever;
    // always + a bounded request turns that into the explicit retry screen.
    networkMode: "always",
    retry: 1,
    // Membership can be revoked or changed while this device is open. Poll the
    // tiny RPC so an old owner/dispatcher surface is unmounted promptly instead
    // of keeping sensitive cached screens visible until the next app focus.
    //
    // Отзыв приезжает ОТВЕТОМ сервера, а не его отсутствием: упавший опрос
    // оставляет прошлый успешный `data` на месте, и границы прав намеренно
    // продолжают им пользоваться (fail-open, см. RoleCapabilityBoundary) —
    // иначе пропавшая сеть выкидывала бы владельца с экрана денег.
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<UserRole | null> => {
      const { data, error } = await withRoleLookupTimeout(
        supabase.rpc("current_user_role"),
      );
      if (error) throw new Error(error.message);
      if (data == null) return null;
      if (!isUserRole(data)) throw new Error("Сервер вернул неизвестную роль");
      return data;
    },
  });
}

// PostgREST surfaces an RLS refusal as a raw English message — translate
// the common case so a dispatcher/master user sees why the save failed.
function friendlyTenantError(message: string): string {
  return /row-level security/i.test(message)
    ? "Недостаточно прав: изменять профиль бизнеса может только владелец."
    : message;
}

export function useTenant() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["tenant", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "current_tenant_profile_safe",
      );
      if (error) {
        if (isMissingSafeTenantRpc(error)) {
          const fallback = await readTenantProfileFallback(
            tenantId as string,
            role as UserRole,
          );
          setDefaultCurrency(fallback?.currency);
          return fallback;
        }
        throw new Error(error.message);
      }
      const profile = parseTenantProfile(data);
      // Валюта тенанта — в реестр форматтеров: все суммы продукта печатаются
      // ею, а не евро (см. money.ts).
      setDefaultCurrency(profile?.currency);
      return profile;
    },
  });
}

export function useUpdateTenant() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: TenantUpdate) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { error, count } = await supabase
        .from("tenants")
        .update(patch, { count: "exact" })
        .eq("id", tenantId);
      if (error) throw new Error(friendlyTenantError(error.message));
      // RLS silently filters rows it refuses to update — 0 affected rows
      // for a non-owner is a permissions failure, not a success.
      if (count === 0)
        throw new Error(friendlyTenantError("row-level security"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant"] });
      // Реквизиты и нумерация печатаются в документах: «следующий номер» и
      // предпросмотр обязаны пересчитаться сразу, а не после перезахода.
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
