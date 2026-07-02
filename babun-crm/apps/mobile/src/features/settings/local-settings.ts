import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import {
  loadCalendarSettings,
  saveCalendarSettings,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import {
  getCalendarSettings,
  updateCalendarSettings,
} from "@babun/shared/db/repositories/calendar-settings";
import {
  loadLoyalty,
  saveLoyalty,
  type LoyaltySettings,
  type LoyaltyTier,
} from "@babun/shared/local/loyalty";
import {
  loadLocationLabels,
  saveLocationLabels,
  type LocationLabel,
} from "@babun/shared/local/location-labels";
import {
  SEED_PERSONAL_EVENT_TYPES,
  loadPersonalEventTypes,
  savePersonalEventTypes,
  type PersonalEventType,
  type PersonalEventTypeIcon,
} from "@babun/shared/local/personal-event-types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type { LocationLabel } from "@babun/shared/local/location-labels";
export type { PersonalEventType } from "@babun/shared/local/personal-event-types";

// Settings live in the canonical Supabase tables (calendar_settings,
// tenant_loyalty_settings, personal_event_types — same as web), so changes
// sync across devices. MMKV via the storage seam is only a write-through
// cache: every successful read/save refreshes it, and reads fall back to it
// when the network / RLS fails. Location labels have no canonical table yet
// and stay device-local.

// ─── Calendar settings (calendar_settings, one row per tenant) ───────
export function useCalendarSettings() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["calendar-settings", tenantId],
    queryFn: async (): Promise<CalendarSettings> => {
      if (tenantId) {
        try {
          const s = await getCalendarSettings(supabase, tenantId);
          saveCalendarSettings(s); // refresh the offline cache
          return s;
        } catch {
          // offline / RLS — fall through to the device cache
        }
      }
      return loadCalendarSettings();
    },
  });
}

export function useSaveCalendarSettings() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    // Targeted PATCH, not a full-object write: only the fields the user
    // actually changed go to Supabase (updateCalendarSettings upserts
    // field-by-field), so a save fired before the canonical row loaded
    // can never clobber web-managed settings with defaults.
    mutationFn: async (patch: Partial<CalendarSettings>) => {
      const merged = { ...loadCalendarSettings(), ...patch };
      saveCalendarSettings(merged); // device cache first — offline safety
      if (tenantId) {
        const canonical = await updateCalendarSettings(supabase, tenantId, patch);
        saveCalendarSettings(canonical); // re-sync cache with the server row
        return canonical;
      }
      return merged;
    },
    onSuccess: (s) => qc.setQueryData(["calendar-settings", tenantId], s),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// ─── Loyalty (tenant_loyalty_settings, one row per tenant) ───────────
type LoyaltyRow = Database["public"]["Tables"]["tenant_loyalty_settings"]["Row"];

function rowToLoyalty(r: LoyaltyRow): LoyaltySettings {
  const tiers = Array.isArray(r.tiers)
    ? (r.tiers as unknown[]).filter(
        (t): t is LoyaltyTier =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as LoyaltyTier).threshold === "number" &&
          typeof (t as LoyaltyTier).percent === "number",
      )
    : [];
  return {
    enabled: r.enabled,
    tiers: [...tiers].sort((a, b) => a.threshold - b.threshold),
  };
}

export function useLoyalty() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["loyalty", tenantId],
    queryFn: async (): Promise<LoyaltySettings> => {
      if (tenantId) {
        try {
          const { data, error } = await supabase
            .from("tenant_loyalty_settings")
            .select("*")
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (data) {
            const s = rowToLoyalty(data);
            try {
              saveLoyalty(s);
            } catch {
              // cache write is best-effort
            }
            return s;
          }
          // No row yet — pre-sync installs keep their device data as
          // the seed; the first save pushes it to Supabase.
        } catch {
          // offline — device cache below
        }
      }
      return loadLoyalty();
    },
  });
}

export function useSaveLoyalty() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: LoyaltySettings) => {
      try {
        saveLoyalty(s); // device cache — best-effort
      } catch {
        // never block the canonical write on a cache hiccup
      }
      if (tenantId) {
        const { error } = await supabase.from("tenant_loyalty_settings").upsert(
          {
            tenant_id: tenantId,
            enabled: s.enabled,
            tiers: s.tiers as unknown as LoyaltyRow["tiers"],
          },
          { onConflict: "tenant_id" },
        );
        if (error) throw new Error(error.message);
      }
      return s;
    },
    onSuccess: (s) => qc.setQueryData(["loyalty", tenantId], s),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// ─── Location labels (device-local, no canonical table yet) ──────────
export function useLocationLabels() {
  return useQuery({
    queryKey: ["location-labels"],
    queryFn: () => loadLocationLabels(),
    staleTime: Infinity,
  });
}

export function useSaveLocationLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (l: LocationLabel[]) => {
      saveLocationLabels(l);
      return l;
    },
    onSuccess: (l) => qc.setQueryData(["location-labels"], l),
  });
}

// ─── Personal event types (personal_event_types, row per type) ───────
type EventTypeRow = Database["public"]["Tables"]["personal_event_types"]["Row"];

function rowToEventType(r: EventTypeRow): PersonalEventType {
  return {
    id: r.id,
    label: r.label,
    icon: r.icon as PersonalEventTypeIcon,
    color: r.color,
    defaultDuration: r.default_duration,
    allDay: r.all_day,
    order: r.position,
  };
}

export function usePersonalEventTypes() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["event-types", tenantId],
    queryFn: async (): Promise<PersonalEventType[]> => {
      if (tenantId) {
        try {
          // Fetch ALL rows (active + soft-deleted): an empty ACTIVE set is
          // ambiguous — «never synced» (→ device seeds) vs «user deleted
          // every type» (→ []). Soft-deleted rows prove the table has
          // synced, so the seeds must NOT resurrect (the next save would
          // re-upload them as live rows).
          const { data, error } = await supabase
            .from("personal_event_types")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("position");
          if (error) throw new Error(error.message);
          if (data.length > 0) {
            const list = data
              .filter((r) => r.is_active)
              .map(rowToEventType);
            savePersonalEventTypes(list);
            return list;
          }
          // No rows at all — first run: the local loader returns the cached
          // list or the iOS-style seeds; the first save pushes them up.
        } catch {
          // offline — device cache below
        }
      }
      return loadPersonalEventTypes();
    },
  });
}

export function useSavePersonalEventTypes() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      types,
      removeIds = [],
    }: {
      types: PersonalEventType[];
      /** Ids the user explicitly deleted in THIS action. */
      removeIds?: string[];
    }) => {
      let list = types;
      const retiredSeedIds: string[] = [];
      if (tenantId) {
        // The fixed seed ids ('ev-lunch', …) are identical for every user,
        // but rows are author-scoped (PK (tenant_id,id) + created_by RLS):
        // the second user of a tenant pushing the seeds would collide with
        // the first user's rows, and ON CONFLICT UPDATE dies on the RLS
        // UPDATE policy (42501) — forever. Re-key seeds to per-user ids
        // before the first push. Deterministic (uid + seed id) so a retry
        // after a half-failed save maps to the same rows, never duplicates.
        const seedIds = new Set(SEED_PERSONAL_EVENT_TYPES.map((s) => s.id));
        if (types.some((t) => seedIds.has(t.id))) {
          const { data: auth } = await supabase.auth.getSession();
          const uid = auth.session?.user.id;
          list = types.map((t) => {
            if (!uid || !seedIds.has(t.id)) return t;
            retiredSeedIds.push(t.id);
            return { ...t, id: `pet-${uid}-${t.id}` };
          });
        }
      }
      savePersonalEventTypes(list); // device cache — offline safety
      if (tenantId) {
        if (list.length > 0) {
          const { error } = await supabase.from("personal_event_types").upsert(
            list.map((t, i) => ({
              id: t.id,
              tenant_id: tenantId,
              label: t.label,
              icon: t.icon,
              color: t.color,
              default_duration: t.defaultDuration,
              all_day: t.allDay,
              position: i,
              is_active: true,
            })),
            { onConflict: "tenant_id,id" },
          );
          if (error) throw new Error(error.message);
        }
        // Soft-delete ONLY what the user explicitly removed (plus this
        // user's own legacy seed-id rows retired by the re-key above).
        // Deriving deletions from «rows missing from the snapshot» wiped
        // types created concurrently on another device — the snapshot is
        // a 30s-stale cache or the offline fallback. is_active=false
        // keeps FK integrity for appointments.event_type_id, mirroring
        // the reference tables.
        const gone = [...removeIds, ...retiredSeedIds];
        if (gone.length > 0) {
          const { error: delErr } = await supabase
            .from("personal_event_types")
            .update({ is_active: false })
            .eq("tenant_id", tenantId)
            .in("id", gone);
          if (delErr) throw new Error(delErr.message);
        }
      }
      return list;
    },
    onSuccess: (t) => qc.setQueryData(["event-types", tenantId], t),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
