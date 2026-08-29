import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";

/** Черновик варианта в редакторе: имя, цена, длительность. Считать нечего,
 *  поэтому ни режимов, ни единиц, ни правила «свыше» у него нет. */
export interface VariantDraft {
  id: string;
  name: string;
  price: string;
  duration: string;
}

export type ServiceVariant =
  Database["public"]["Tables"]["service_variants"]["Row"];

/**
 * ВАРИАНТЫ УСЛУГИ — ПЛОСКИЙ СПИСОК БЕЗ МАТЕМАТИКИ.
 *
 * Трёхкомнатная квартира — это НЕ «три раза комната», и семикомнатная не
 * выводится экстраполяцией: между вариантами нет связи, которую можно
 * посчитать. Поэтому здесь нет ни порогов, ни правила «свыше», ни режима
 * цены — только имя, цена и длительность.
 *
 * ЧИТАЮТСЯ ВСЕ ВАРИАНТЫ ТЕНАНТА РАЗОМ. Их немного (у услуги их 2–5, у тенанта
 * услуг десятки), а запрос по одной услуге означал бы новый запрос на каждое
 * открытие листа и на каждую строку каталога в записи.
 */
export function useServiceVariants() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["service-variants", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ServiceVariant[]> => {
      // RLS отдаёт варианты только владельцу — у мастера и диспетчера запрос
      // вернёт пусто, и это правильно: их каталог приезжает проекцией.
      const { data, error } = await supabase
        .from("service_variants")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("position");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export interface VariantInput {
  name: string;
  price: number;
  duration_min: number;
  cost?: number;
}

/**
 * ЗАПИСЬ ВАРИАНТОВ — ЦЕЛИКОМ, А НЕ ПО ОДНОМУ.
 *
 * Лист услуги правит список как одно целое: переставили, переименовали, убрали
 * средний. Три отдельные мутации на это дали бы три состояния, в которых
 * документ уже не тот, что был, но ещё не тот, что будет, — а между ними может
 * упасть сеть. Здесь одна операция: снести старые и записать новые в их
 * порядке.
 */
export function useSaveServiceVariants() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceId,
      variants,
    }: {
      serviceId: string;
      variants: VariantInput[];
    }) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Менять услуги может только владелец.");
      }
      const { error: wipeError } = await supabase
        .from("service_variants")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("service_id", serviceId);
      if (wipeError) throw new Error(wipeError.message);

      if (variants.length === 0) return;
      const { error } = await supabase.from("service_variants").insert(
        variants.map((variant, index) => ({
          id: generateId("svcvar"),
          tenant_id: tenantId,
          service_id: serviceId,
          name: variant.name,
          price: variant.price,
          duration_min: variant.duration_min,
          cost: variant.cost ?? 0,
          position: index,
        })),
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-variants"] });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
    meta: { errorHandled: true },
  });
}
