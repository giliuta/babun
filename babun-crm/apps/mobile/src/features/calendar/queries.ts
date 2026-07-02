import { useQuery } from "@tanstack/react-query";
import { listAppointments as listAppointmentsCached } from "@babun/shared/sync/appointmentsCached";
import { listDayExtras } from "@babun/shared/db/repositories/day-extras";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// PostgREST silently caps every response at 1000 rows (Supabase default
// max-rows), so an unordered, unlimited listAppointments truncates a busy
// tenant's calendar without any error.
//
// STORY-062 slice 5 — READS now go through the offline-aware SWR wrapper
// (appointmentsCached.listAppointments). The slice-4 blocker is closed: the
// wrapper stores the FULL domain Appointment and its background revalidate
// prunes server-deleted rows (cacheReplaceTenant) and, on a real change, fires
// `revalidated`, which the realtime bridge (SyncBridgeMount) turns into a
// react-query invalidate so pull-to-refresh and focus refetch settle on fresh
// data. Warm cache serves the last snapshot offline; a cold offline read
// returns [] (empty grid, not an error). Writes already go through the wrapper.
//
// PAGING is preserved by threading the self-paging shim BELOW into the wrapper
// as its supabase client. `listAppointments` uses that client both for the
// cold-cache read and the background revalidate, so every server list still
// loops the 1000-row windows internally. The shim intercepts `from → select →
// eq` (the exact chain repoListAppointments builds — the wrapper calls the
// same repo under the hood) and throws on any other builder method so a
// query-shape drift fails loudly instead of mis-paging.
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

// All tenant appointments (RLS-scoped), read via the offline-aware SWR wrapper
// and paged around the 1000-row cap by threading the shim above in as the
// wrapper's supabase client. Retained name/signature: useClientAppointments
// imports this.
export async function listAppointmentsPaged(
  tenantId: string,
): Promise<Appointment[]> {
  return listAppointmentsCached(pagingClient(), tenantId);
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
