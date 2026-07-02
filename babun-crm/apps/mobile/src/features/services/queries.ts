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

export function useCreateService() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      price: number;
      duration_minutes: number;
    }) => {
      const { data, error } = await supabase
        .from("services")
        .insert({
          id: generateId("svc"),
          tenant_id: tenantId as string,
          name: input.name,
          price: input.price,
          duration_minutes: input.duration_minutes,
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
