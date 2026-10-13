import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { referenceKeys, type RefTable } from "../query-keys";
import type { Tables } from "./types";

// ─── Update / delete (generic) ───────────────────────────────────────
// Delete is a soft-delete (is_active=false): keeps FK integrity for
// appointments that reference team_id / master_id, and the list filter
// (is_active=true) hides them.
type RefUpdate<Table extends RefTable> = Tables[Table]["Update"];

export function assertCanWriteReference(
  table: RefTable,
  role: ReturnType<typeof useDataRole>["data"],
): void {
  if (table === "cities") {
    // Сотрудник — по праву «Метки» своей команды (30.09): строку чужой
    // команды отобьёт политика `cities_write_access`.
    if (role === "owner" || role === "dispatcher" || role === "master") return;
    throw new Error("Изменять метки может владелец или диспетчер.");
  }
  // Услуги сотрудник правит по праву «Услуги» своей команды (30.09): строку
  // чужой команды отобьёт политика `services_write_access`.
  if (table === "services" && role === "master") return;
  if (role !== "owner") {
    throw new Error("Изменять этот справочник может только владелец.");
  }
}

export async function updateRefRow<Table extends RefTable>(args: {
  table: Table;
  tenantId: string;
  id: string;
  patch: RefUpdate<Table>;
}): Promise<void> {
  const confirm = (
    data: { id: string } | null,
    error: { message: string } | null,
  ) => {
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Запись не найдена или недоступна.");
  };
  // supabase-js cannot preserve a correlated generic table/update type
  // through `from(table)`, so keep the public hook generic and narrow the
  // four concrete builders here instead of escaping through `any`.
  switch (args.table) {
    case "teams": {
      const { data, error } = await supabase
        .from("teams")
        .update(args.patch as Tables["teams"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "masters": {
      const { data, error } = await supabase
        .from("masters")
        .update(args.patch as Tables["masters"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "cities": {
      const { data, error } = await supabase
        .from("cities")
        .update(args.patch as Tables["cities"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
      return;
    }
    case "services": {
      const { data, error } = await supabase
        .from("services")
        .update(args.patch as Tables["services"]["Update"])
        .eq("tenant_id", args.tenantId)
        .eq("id", args.id)
        .select("id")
        .maybeSingle();
      confirm(data, error);
    }
  }
}

function useRefUpdate<Table extends RefTable>(table: Table) {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: RefUpdate<Table>;
    }) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference(table, role);
      await updateRefRow({ table, tenantId, id, patch });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.table(table) }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

function useRefDelete(table: RefTable) {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference(table, role);
      await updateRefRow({
        table,
        tenantId,
        id,
        patch: { is_active: false } as RefUpdate<typeof table>,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.table(table) }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

export const useUpdateTeam = () => useRefUpdate("teams");
export const useUpdateMaster = () => useRefUpdate("masters");
export const useDeleteMaster = () => useRefDelete("masters");
// Удаления КАЛЕНДАРЯ здесь больше нет. С 2026-09-21 оно в два шага — в архив и
// стереть из архива — и живёт целиком в `features/calendar/useCalendarDelete`.
export const useUpdateCity = () => useRefUpdate("cities");
export const useDeleteCity = () => useRefDelete("cities");
export const useUpdateService = () => useRefUpdate("services");
export const useDeleteService = () => useRefDelete("services");
