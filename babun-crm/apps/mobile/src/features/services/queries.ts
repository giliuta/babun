import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

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

export function useServices() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["services", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
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
}

export function useCreateService() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput) => {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string }) => {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; color?: string | null };
    }) => {
      const { error } = await supabase
        .from("service_categories")
        .update(patch)
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("service_categories")
        .update({ is_active: false })
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-categories"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
