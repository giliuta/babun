import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

type Tables = Database["public"]["Tables"];
export type Team = Tables["teams"]["Row"];
export type Master = Tables["masters"]["Row"];
export type City = Tables["cities"]["Row"];

// ─── Teams ───────────────────────────────────────────────────────────
export function useTeams() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["teams", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateTeam() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      region?: string;
      color?: string;
    }) => {
      const { data, error } = await supabase
        .from("teams")
        .insert({
          id: generateId("team"),
          tenant_id: tenantId as string,
          name: input.name,
          region: input.region || null,
          color: input.color || null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Masters ─────────────────────────────────────────────────────────
export function useMasters() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["masters", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("masters")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateMaster() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { full_name: string; phone?: string }) => {
      const { data, error } = await supabase
        .from("masters")
        .insert({
          id: generateId("master"),
          tenant_id: tenantId as string,
          full_name: input.full_name,
          phone: input.phone || null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["masters"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Cities ──────────────────────────────────────────────────────────
export function useCities() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["cities", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cities")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateCity() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; country?: string }) => {
      const { data, error } = await supabase
        .from("cities")
        .insert({
          id: generateId("city"),
          tenant_id: tenantId as string,
          name: input.name,
          country: input.country || "",
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cities"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

// ─── Update / delete (generic) ───────────────────────────────────────
// Delete is a soft-delete (is_active=false): keeps FK integrity for
// appointments that reference team_id / master_id, and the list filter
// (is_active=true) hides them.
type RefTable = "teams" | "masters" | "cities" | "services";

function useRefUpdate(table: RefTable) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Record<string, unknown>;
    }) => {
      const { error } = await (supabase.from(table) as any)
        .update(patch)
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

function useRefDelete(table: RefTable) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table) as any)
        .update({ is_active: false })
        .eq("tenant_id", tenantId as string)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

export const useUpdateTeam = () => useRefUpdate("teams");
export const useDeleteTeam = () => useRefDelete("teams");
export const useUpdateMaster = () => useRefUpdate("masters");
export const useDeleteMaster = () => useRefDelete("masters");
export const useUpdateCity = () => useRefUpdate("cities");
export const useDeleteCity = () => useRefDelete("cities");
export const useUpdateService = () => useRefUpdate("services");
export const useDeleteService = () => useRefDelete("services");
