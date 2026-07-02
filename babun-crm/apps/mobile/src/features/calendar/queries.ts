import { useQuery } from "@tanstack/react-query";
import { listAppointments as repoListAppointments } from "@babun/shared/db/repositories/appointments";
import { listDayExtras } from "@babun/shared/db/repositories/day-extras";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// PostgREST silently caps every response at 1000 rows (Supabase default
// max-rows), so an unordered, unlimited listAppointments truncates a busy
// tenant's calendar without any error.
//
// STORY-062 slice 4 — WRITES go through the offline-aware wrappers
// (appointmentsCached.create/update/delete). READS stay on the repo
// (repoListAppointments): the SWR wrapper's warm-cache branch returns the
// stale sqlite snapshot synchronously and only revalidates into sqlite — it
// never bumps the react-query cache (mobile has no realtime bridge like the
// web's useRealtimeTenantSync), so pull-to-refresh would visibly no-op and
// the list would drift stale. Reading straight from the repo keeps every
// fetch authoritative and fresh, exactly as before slice 4; the wrappers'
// optimistic sqlite layer is still the offline safety net for writes.
//
// We keep paging AROUND the query at the client level: the self-paging shim
// below intercepts `from → select → eq` (the exact chain repoListAppointments
// builds) and returns a PostgREST-thenable that loops every 1000-row window
// internally, resolving to the FULL row set. If the chain ever changes shape,
// the shim throws (undefined method) instead of mis-paging.
const APPT_PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = { data: any[] | null; error: unknown };

// A client that resolves `from(t).select(cols).eq(col,val)` to ALL pages.
// The returned object is thenable so both `await client.from()...eq()` and
// `client.from()...eq().then()` (whatever the caller does) get the full set.
function pagingClient(): typeof supabase {
  const runAllPages = async (
    table: string,
    columns: string,
    column: string,
    value: string,
  ): Promise<AnyResult> => {
    const all: unknown[] = [];
    for (let offset = 0; ; offset += APPT_PAGE_SIZE) {
      const { data, error } = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((supabase.from as any)(table)
        .select(columns)
        .eq(column, value)
        // date alone is not unique — without the id tiebreaker PostgREST
        // paging can skip / duplicate rows across pages.
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + APPT_PAGE_SIZE - 1) as PromiseLike<AnyResult>);
      if (error) return { data: null, error };
      const page = data ?? [];
      all.push(...page);
      if (page.length < APPT_PAGE_SIZE) break;
    }
    return { data: all as AnyResult["data"], error: null };
  };

  // Guard: any builder method the shim doesn't model (e.g. a future `.order`
  // / `.range` / `.maybeSingle` added to repoListAppointments) throws a clear
  // error instead of silently returning `undefined` — so a query-shape drift
  // fails loudly at the exact call, not as a downstream «x is not a function».
  const throwUnexpected = (method: string) => (): never => {
    throw new Error(
      `pagingClient: unexpected query method ".${method}" — the paging shim ` +
        `only models from→select→eq; update the shim if the read chain changed.`,
    );
  };

  return {
    from: (table: string) => ({
      select: (columns: string) => ({
        // Thenable + explicit throw-guards for every builder method the shim
        // does NOT model. A repo read that appends `.order/.range/.limit/
        // .maybeSingle/.is` after `.eq` would otherwise hit `undefined()`.
        eq: (column: string, value: string) => ({
          then: (
            onFulfilled: ((value: AnyResult) => unknown) | null | undefined,
            onRejected: ((e: unknown) => unknown) | null | undefined,
          ) =>
            runAllPages(table, columns, column, value).then(
              onFulfilled ?? undefined,
              onRejected ?? undefined,
            ),
          order: throwUnexpected("order"),
          range: throwUnexpected("range"),
          limit: throwUnexpected("limit"),
          maybeSingle: throwUnexpected("maybeSingle"),
          single: throwUnexpected("single"),
          is: throwUnexpected("is"),
        }),
      }),
    }),
  } as unknown as typeof supabase;
}

// All tenant appointments (RLS-scoped), read from the repo and paged around
// the 1000-row cap via the shim above. Retained name/signature:
// useClientAppointments imports this.
export async function listAppointmentsPaged(
  tenantId: string,
): Promise<Appointment[]> {
  return repoListAppointments(pagingClient(), tenantId);
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
