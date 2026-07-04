import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listDayCities,
  setDayCity,
} from "@babun/shared/db/repositories/day-cities";
import { dayCityKey } from "@babun/shared/local/day-cities";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Метки дней («город бригады на дату») — web parity STORY-044 day_cities.
// Shape: Record<"teamId:YYYY-MM-DD", cityName> (shared dayCityKey).

export { dayCityKey };

export function useDayCities() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["day-cities", tenantId],
    enabled: !!tenantId,
    queryFn: () => listDayCities(supabase, tenantId as string),
  });
}

/** Upsert/clear одной метки (пустой city = снять). */
export function useSetDayCity() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { teamId: string; date: string; city: string }) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      await setDayCity(supabase, tenantId, input.teamId, input.date, input.city);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["day-cities"] }),
  });
}
