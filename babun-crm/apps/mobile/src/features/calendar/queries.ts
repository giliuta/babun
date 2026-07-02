import { useQuery } from "@tanstack/react-query";
import { listAppointments } from "@babun/shared/db/repositories/appointments";
import { listDayExtras } from "@babun/shared/db/repositories/day-extras";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// PostgREST silently caps every response at 1000 rows (Supabase default
// max-rows), so an unordered, unlimited listAppointments truncates a busy
// tenant's calendar without any error. The shared repo has no paging
// params (packages/shared is read-only for the mobile port), so we page
// AROUND it: listAppointments builds exactly
//   supabase.from("appointments").select(cols).eq("tenant_id", id)
// and awaits the builder — the shim below hands it a client whose chain
// appends a stable order + range window before PostgREST executes. If the
// repo's query chain ever changes, the shim throws (undefined method)
// instead of silently mis-paging.
const APPT_PAGE_SIZE = 1000;

function pagedClient(offset: number): typeof supabase {
  return {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from as any)(table)
            .select(columns)
            .eq(column, value)
            // date alone is not unique — without the id tiebreaker
            // PostgREST paging can skip / duplicate rows across pages.
            .order("date", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + APPT_PAGE_SIZE - 1),
      }),
    }),
  } as unknown as typeof supabase;
}

export async function listAppointmentsPaged(
  tenantId: string,
): Promise<Appointment[]> {
  const all: Appointment[] = [];
  for (let offset = 0; ; offset += APPT_PAGE_SIZE) {
    const page = await listAppointments(pagedClient(offset), tenantId);
    all.push(...page);
    if (page.length < APPT_PAGE_SIZE) return all;
  }
}

// All tenant appointments (RLS-scoped) — shared cache key with the per-client
// hook (which adds a `select` filter on top of the same data).
export function useAppointments() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["appointments", tenantId],
    enabled: !!tenantId,
    queryFn: () => listAppointmentsPaged(tenantId as string),
  });
}

// Manual per-day income/expense line items, keyed "teamId:date" (shared
// DayExtrasMap shape). Feeds computeDayFinance in the day-finance footer.
export function useDayExtras() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["day-extras", tenantId],
    enabled: !!tenantId,
    queryFn: () => listDayExtras(supabase, tenantId as string),
  });
}
