import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listDayCities,
  renameDayCity,
  setDayCity,
} from "@babun/shared/db/repositories/day-cities";
import { dayCityKey, type DayCityMap } from "@babun/shared/local/day-cities";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole, type UserRole } from "@/features/settings/tenant";

// Метки дней («город бригады на дату») — web parity STORY-044 day_cities.
// Shape: Record<"teamId:YYYY-MM-DD", cityName> (shared dayCityKey).

export { dayCityKey };

/** Единый ключ кэша карты меток дней — читается и автоприсвоением
 *  метки клиенту (label-auto-assign), не только хуками этого модуля. */
export function dayCitiesQueryKey(
  tenantId: string | null,
  role: UserRole | null | undefined,
) {
  return ["day-cities", tenantId, role ?? "role-pending"] as const;
}

export function useDayCities() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  return useQuery({
    queryKey: dayCitiesQueryKey(tenantId, roleQuery.data),
    enabled: !!tenantId && roleQuery.isSuccess && roleQuery.data != null,
    queryFn: () => listDayCities(supabase, tenantId as string),
  });
}

/** Каскад переименования метки по всем дням (rename в библиотеке меток). */
export function useRenameDayCity() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; to: string }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Изменять метки может владелец или диспетчер.");
      }
      await renameDayCity(supabase, tenantId, input.from, input.to);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["day-cities"] }),
    meta: { errorHandled: true }, // экран меток агрегирует ошибки каскада сам
  });
}

/** Upsert/clear одной метки (пустой city = снять). */
export function useSetDayCity() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { teamId: string; date: string; city: string }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Изменять метки может владелец или диспетчер.");
      }
      await setDayCity(supabase, tenantId, input.teamId, input.date, input.city);
    },
    // Оптимистика (по образцу useUpdateAppointment): пилл дня перекрашивается
    // сразу, не дожидаясь roundtrip'а; ошибка/офлайн откатывают к снапшоту.
    onMutate: async (input) => {
      const key = dayCitiesQueryKey(tenantId, role);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DayCityMap>(key);
      if (previous) {
        const next = { ...previous };
        const k = dayCityKey(input.teamId, input.date);
        const trimmed = input.city.trim();
        if (trimmed) next[k] = trimmed;
        else delete next[k]; // пустая метка = снять (семантика setDayCity)
        qc.setQueryData<DayCityMap>(key, next);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(dayCitiesQueryKey(tenantId, role), ctx.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["day-cities"] }),
  });
}
