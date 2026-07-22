import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  dispatcherServiceJsonToService,
  masterServiceJsonToService,
} from "@/features/settings/master-reference";

// Services live in the canonical `services` table (text PK, was localStorage-
// only before the migration). No shared repo yet — query the typed client
// directly. Same pattern will cover teams / masters / cities.
export type Service = Database["public"]["Tables"]["services"]["Row"];
export type ServiceCategory =
  Database["public"]["Tables"]["service_categories"]["Row"];

/** services.brigade_ids хранится как Json — сузить до string[]. Пусто = все
 *  команды делают услугу (web parity). */
export function serviceBrigadeIds(s: Service): string[] {
  return Array.isArray(s.brigade_ids)
    ? (s.brigade_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
}

function isMissingProjectionRpc(error: {
  code?: string;
  message?: string;
}): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

async function listMasterServices(tenantId: string): Promise<Service[]> {
  const { data, error } = await supabase.rpc("list_master_services_safe");
  if (!error) return (data ?? []).map(masterServiceJsonToService);
  if (!isMissingProjectionRpc(error)) throw new Error(error.message);

  // Rolling-deploy fallback against the older member-wide RLS policy. The
  // explicit projection prevents service economics from crossing the wire.
  const fallback = await supabase
    .from("services")
    .select("id, tenant_id, name, color")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position");
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) =>
    masterServiceJsonToService(row as unknown as Json),
  );
}

async function listDispatcherServices(tenantId: string): Promise<Service[]> {
  const { data, error } = await supabase.rpc(
    "list_dispatcher_services_safe",
  );
  if (!error) return (data ?? []).map(dispatcherServiceJsonToService);
  if (!isMissingProjectionRpc(error)) throw new Error(error.message);

  const fallback = await supabase
    .from("services")
    .select(
      "id, tenant_id, category_id, name, price, duration_minutes, color, is_countable, price_tiers, duration_tiers, bulk_threshold, bulk_price, brigade_ids, is_active, position, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position");
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) =>
    dispatcherServiceJsonToService(row as unknown as Json),
  );
}

export function useServices() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["services", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      if (role === "master") {
        return listMasterServices(tenantId as string);
      }
      if (role === "dispatcher") {
        return listDispatcherServices(tenantId as string);
      }
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export interface ServiceInput {
  name: string;
  price: number;
  duration_minutes: number;
  category_id?: string | null;
  color?: string;
  brigade_ids?: string[];
  cost_per_unit?: number;
  is_countable?: boolean;
  price_tiers?: Service["price_tiers"];
  duration_tiers?: Service["duration_tiers"];
  bulk_threshold?: number;
  bulk_price?: number;
}

export function useCreateService() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput) => {
      if (role !== "owner") {
        throw new Error("Создавать услуги может только владелец.");
      }
      const { data, error } = await supabase
        .from("services")
        .insert({
          id: generateId("svc"),
          tenant_id: tenantId as string,
          name: input.name,
          price: input.price,
          duration_minutes: input.duration_minutes,
          category_id: input.category_id ?? null,
          ...(input.color ? { color: input.color } : {}),
          ...(input.brigade_ids ? { brigade_ids: input.brigade_ids } : {}),
          ...(input.cost_per_unit !== undefined
            ? { cost_per_unit: input.cost_per_unit }
            : {}),
          ...(input.is_countable !== undefined
            ? { is_countable: input.is_countable }
            : {}),
          ...(input.price_tiers !== undefined
            ? { price_tiers: input.price_tiers }
            : {}),
          ...(input.duration_tiers !== undefined
            ? { duration_tiers: input.duration_tiers }
            : {}),
          ...(input.bulk_threshold !== undefined
            ? { bulk_threshold: input.bulk_threshold }
            : {}),
          ...(input.bulk_price !== undefined
            ? { bulk_price: input.bulk_price }
            : {}),
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Категории услуг (service_categories, цветные группы) ───────────
export function useServiceCategories() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["service-categories", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_categories")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateServiceCategory() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string }) => {
      if (role !== "owner") {
        throw new Error("Изменять категории услуг может только владелец.");
      }
      const { data, error } = await supabase
        .from("service_categories")
        .insert({
          id: generateId("cat"),
          tenant_id: tenantId as string,
          name: input.name,
          color: input.color ?? null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateServiceCategory() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; color?: string | null };
    }) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Изменять категории услуг может только владелец.");
      }
      const { data, error } = await supabase
        .from("service_categories")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Категория не найдена или недоступна.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** Мягкое удаление (is_active=false): услуги категории не трогаем — они
 *  становятся «без категории» на чтении (web parity: услуга держит
 *  category_id, группировка не находит категорию и падает в fallback). */
export function useDeleteServiceCategory() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Изменять категории услуг может только владелец.");
      }
      const { data, error } = await supabase
        .from("service_categories")
        .update({ is_active: false })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Категория не найдена или недоступна.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
