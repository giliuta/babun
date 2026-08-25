import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  appointmentsQueryKey,
  listAppointmentsPaged,
} from "@/features/calendar/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
import { useCurrentRole } from "@/features/settings/tenant";
import { useTenantId } from "@/lib/tenant";

// Appointments for a single client — TanStack Query on top of the shared
// Supabase repository (port-as-is). The repo has no per-client list helper,
// so we fetch the tenant's appointments (RLS-scoped) and filter to this
// client in `select`. The list query is cached per-tenant, so opening
// several client cards reuses one network round-trip.
//
// KNOWN DIVERGENCE vs web: buildStatsMap on the web also name-matches
// legacy seed rows with client_id=null (name baked into `comment`). Here we
// deliberately pass ONLY strict client_id matches: the card blocks
// (Visits / Objects / Finance) render every row they receive, so letting
// null-id rows through would require duplicating that name matching at
// this layer. Live Supabase bookings always carry client_id; tenants with
// unmigrated legacy seed data may show fewer visits/LTV than the web list.
export function useClientAppointments(clientId: string) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  // Stable `select` identity — an inline arrow would make TanStack re-run
  // the tenant-wide filter on every render of every consumer.
  const select = useCallback(
    (all: Appointment[]) => all.filter((a) => a.client_id === clientId),
    [clientId],
  );
  return useQuery({
    queryKey: appointmentsQueryKey(tenantId, role),
    enabled:
      !!tenantId && !!clientId && roleQuery.isSuccess && role != null,
    queryFn: () => {
      if (role === "master") return listMasterAppointmentsSafePaged();
      if (role === "owner" || role === "dispatcher") {
        return listAppointmentsPaged(tenantId as string);
      }
      throw new Error("Нет доступа к календарю");
    },
    select,
  });
}
