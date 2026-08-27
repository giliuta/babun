import { useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import {
  loadCalendarSettings,
  loadOperationalCalendarSettings,
  saveCalendarSettings,
  saveOperationalCalendarSettings,
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import {
  getCalendarSettings,
  getOperationalCalendarSettings,
  updateCalendarSettings,
} from "@babun/shared/db/repositories/calendar-settings";
import {
  loadLoyalty,
  saveLoyalty,
  type LoyaltySettings,
  type LoyaltyTier,
} from "@babun/shared/local/loyalty";
import {
  hasLocationLabelsServerSync,
  loadLocationLabels,
  markLocationLabelsServerSynced,
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
import { useCurrentRole } from "@/features/settings/tenant";
import {
  locationLabelRemoveIds,
  positionedLocationLabelUpserts,
} from "@/features/settings/location-label-sync";
import {
  isConfirmedNetworkUnavailable,
  isMissingCalendarSettingsContract,
  isMissingLoyaltySettingsContract,
  isMissingPersonalEventTypesContract,
  type ServerReadError,
} from "@/features/settings/server-read-fallback";
import {
  beginCalendarSave,
  confirmCalendarSave,
  createCalendarSaveState,
  currentCalendarSaveValue,
  rejectCalendarSave,
  type CalendarSaveState,
} from "@/features/settings/calendar-save-state";

export type { LocationLabel } from "@babun/shared/local/location-labels";
export type { PersonalEventType } from "@babun/shared/local/personal-event-types";

// Settings live in the canonical Supabase tables (calendar_settings,
// tenant_loyalty_settings, personal_event_types — same as web), so changes
// sync across devices. MMKV via the storage seam is only a write-through
// cache: every successful read/save refreshes it. Reads may fall back for a
// rolling deployment or a confirmed transport outage; permission and
// validation errors remain visible to the user, and writes never hide network
// failures.

// ─── Calendar settings (calendar_settings, one row per tenant) ───────
function asServerReadError(error: unknown): ServerReadError {
  if (error && typeof error === "object") {
    return error as ServerReadError;
  }
  return { message: String(error) };
}

function serverOperationError(
  operation: string,
  source: ServerReadError,
): Error & ServerReadError {
  const error = new Error(
    `${operation}: ${source.message ?? "неизвестная ошибка сервера"}`,
  ) as Error & ServerReadError;
  error.code = source.code;
  error.details = source.details;
  return error;
}

function calendarReadMayUseCache(error: unknown): boolean {
  const readError = asServerReadError(error);
  return (
    isConfirmedNetworkUnavailable(readError) ||
    isMissingCalendarSettingsContract(readError)
  );
}

function safeLoadCalendarSettings(): CalendarSettings {
  try {
    return loadCalendarSettings();
  } catch {
    return { ...DEFAULT_CALENDAR_SETTINGS };
  }
}

function safeSaveCalendarSettings(settings: CalendarSettings): void {
  try {
    saveCalendarSettings(settings);
  } catch {
    // A cache write is best-effort; the server/query result stays canonical.
  }
}

function safeLoadOperationalCalendarSettings(
  tenantId: string,
): CalendarSettings {
  try {
    return { ...loadOperationalCalendarSettings(tenantId) };
  } catch {
    return { ...DEFAULT_CALENDAR_SETTINGS };
  }
}

function safeSaveOperationalCalendarSettings(
  tenantId: string,
  settings: CalendarSettings,
): void {
  try {
    saveOperationalCalendarSettings(tenantId, settings);
  } catch {
    // Never turn a successful canonical read into an application error.
  }
}

export function useCalendarSettings() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["calendar-settings", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    networkMode: "always",
    queryFn: async (): Promise<CalendarSettings> => {
      const activeTenantId = tenantId as string;
      try {
        if (role === "master") {
          const settings = await getOperationalCalendarSettings(supabase);
          safeSaveOperationalCalendarSettings(activeTenantId, {
            ...settings,
          });
          return { ...settings };
        }
        if (role === "owner" || role === "dispatcher") {
          const s = await getCalendarSettings(supabase, activeTenantId);
          safeSaveCalendarSettings(s);
          return s;
        }
        throw new Error("Роль сотрудника ещё не подтверждена.");
      } catch (error) {
        if (!calendarReadMayUseCache(error)) throw error;
        return role === "master"
          ? safeLoadOperationalCalendarSettings(activeTenantId)
          : safeLoadCalendarSettings();
      }
    },
  });
}

export function useSaveCalendarSettings() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  const scope = `${tenantId ?? "no-tenant"}:${role ?? "role-pending"}`;
  const queryKey = [
    "calendar-settings",
    tenantId,
    role ?? "role-pending",
  ] as const;
  const saveStateRef = useRef<CalendarSaveState>(
    createCalendarSaveState(scope, safeLoadCalendarSettings()),
  );
  if (saveStateRef.current.scope !== scope) {
    saveStateRef.current = createCalendarSaveState(
      scope,
      safeLoadCalendarSettings(),
    );
  }
  return useMutation({
    mutationKey: queryKey,
    networkMode: "always",
    // Targeted PATCH, not a full-object write: only the fields the user
    // actually changed go to Supabase (updateCalendarSettings upserts
    // field-by-field), so a save fired before the canonical row loaded
    // can never clobber web-managed settings with defaults.
    mutationFn: async (patch: Partial<CalendarSettings>) => {
      if (role !== "owner") {
        throw new Error("Изменять настройки календаря может только владелец.");
      }
      if (!tenantId) throw new Error("Нет активной компании");
      return updateCalendarSettings(supabase, tenantId, patch);
    },
    // Instant-commit controls can issue several overlapping patches. Keep an
    // ordered pending set so one failed request rolls back only its own
    // optimistic contribution instead of erasing a later tap.
    onMutate: (patch) => {
      const state = saveStateRef.current;
      if (state.pending.size === 0) {
        state.confirmed =
          qc.getQueryData<CalendarSettings>(queryKey) ??
          safeLoadCalendarSettings();
      }
      const id = beginCalendarSave(state, patch);
      qc.setQueryData(queryKey, currentCalendarSaveValue(state));
      return { id };
    },
    onSuccess: (settings, _patch, context) => {
      const state = saveStateRef.current;
      confirmCalendarSave(state, context?.id, settings);
      // MMKV receives server-confirmed state only. It can therefore never
      // preserve an RLS/validation/network failure as a successful setting.
      safeSaveCalendarSettings(settings);
      qc.setQueryData(queryKey, currentCalendarSaveValue(state));
    },
    onError: (_error, _patch, context) => {
      const state = saveStateRef.current;
      rejectCalendarSave(state, context?.id);
      const restored = currentCalendarSaveValue(state);
      qc.setQueryData(queryKey, restored);
      // Explicitly restore the last server-confirmed cache. This also repairs
      // a value left by an older app build that wrote before awaiting Supabase.
      safeSaveCalendarSettings(state.confirmed);
    },
    onSettled: () => {
      if (saveStateRef.current.pending.size === 0) {
        void qc.invalidateQueries({ queryKey });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// ─── Loyalty (tenant_loyalty_settings, one row per tenant) ───────────
type LoyaltyRow = Database["public"]["Tables"]["tenant_loyalty_settings"]["Row"];

function safeLoadLoyalty(): LoyaltySettings {
  try {
    return loadLoyalty();
  } catch {
    return { enabled: false, tiers: [] };
  }
}

function safeSaveLoyalty(settings: LoyaltySettings): void {
  try {
    saveLoyalty(settings);
  } catch {
    // Canonical query data remains usable even if MMKV is unavailable.
  }
}

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
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["loyalty", tenantId, role ?? "role-pending"],
    enabled:
      !!tenantId &&
      roleQuery.isSuccess &&
      (role === "owner" || role === "dispatcher"),
    networkMode: "always",
    queryFn: async (): Promise<LoyaltySettings> => {
      const cached = safeLoadLoyalty();
      const activeTenantId = tenantId as string;
      try {
        const { data, error } = await supabase
          .from("tenant_loyalty_settings")
          .select("*")
          .eq("tenant_id", activeTenantId)
          .maybeSingle();
        if (error) throw serverOperationError("useLoyalty", error);
        if (data) {
          const settings = rowToLoyalty(data);
          safeSaveLoyalty(settings);
          return settings;
        }
        // No row yet — the device value seeds the first canonical save.
        return cached;
      } catch (error) {
        const readError = asServerReadError(error);
        if (
          isConfirmedNetworkUnavailable(readError) ||
          isMissingLoyaltySettingsContract(readError)
        ) {
          return cached;
        }
        throw error;
      }
    },
  });
}

export function useSaveLoyalty() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  const mutationKey = [
    "loyalty",
    tenantId,
    role ?? "role-pending",
  ] as const;
  return useMutation({
    mutationKey,
    networkMode: "always",
    mutationFn: async (s: LoyaltySettings) => {
      if (role !== "owner") {
        throw new Error("Настраивать программу лояльности может только владелец.");
      }
      if (!tenantId) throw new Error("Нет активной компании");
      const { data, error } = await supabase
        .from("tenant_loyalty_settings")
        .upsert(
          {
            tenant_id: tenantId,
            enabled: s.enabled,
            tiers: s.tiers as unknown as LoyaltyRow["tiers"],
          },
          { onConflict: "tenant_id" },
        )
        .select("tenant_id")
        .maybeSingle();
      if (error) throw serverOperationError("useSaveLoyalty", error);
      if (!data || data.tenant_id !== tenantId) {
        throw new Error("Сохранение программы лояльности не подтверждено сервером");
      }
      return s;
    },
    onSuccess: (s) => {
      safeSaveLoyalty(s);
      qc.setQueryData(
        ["loyalty", tenantId, role ?? "role-pending"],
        s,
      );
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) {
        void qc.invalidateQueries({ queryKey: mutationKey });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// ─── Location labels (location_labels, soft-retained server rows) ────
type LocationLabelRow = Database["public"]["Tables"]["location_labels"]["Row"];

function isMissingLocationLabelsContract(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    /could not find (?:the table|the function).*(?:location_labels|apply_location_label_changes)/i.test(
      error.message ?? "",
    )
  );
}

function rowsToLocationLabels(rows: LocationLabelRow[]): LocationLabel[] {
  return rows
    .filter((row) => row.is_active)
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ id: row.id, name: row.name }));
}

function locationLabelsToJson(
  labels: readonly LocationLabel[],
  order: readonly LocationLabel[] = labels,
): Json {
  const positionById = new Map(
    order.map((label, position) => [label.id, position]),
  );
  return labels.map(
    (label): Json => ({
      id: label.id,
      name: label.name,
      position: positionById.get(label.id) ?? 0,
    }),
  );
}

function loadCachedLocationLabels(tenantId: string): LocationLabel[] {
  try {
    return loadLocationLabels(tenantId);
  } catch {
    return [];
  }
}

function hasCachedLocationLabelsServerSync(tenantId: string): boolean {
  try {
    return hasLocationLabelsServerSync(tenantId);
  } catch {
    return false;
  }
}

function cacheServerLocationLabels(
  tenantId: string,
  labels: LocationLabel[],
): void {
  try {
    saveLocationLabels(labels, tenantId);
    markLocationLabelsServerSynced(tenantId);
  } catch {
    // The server result remains authoritative for this render. A cache write
    // failure must not turn a successful canonical save into a false error.
  }
}

export function useLocationLabels() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["location-labels", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LocationLabel[]> => {
      const activeTenantId = tenantId as string;
      const cached = loadCachedLocationLabels(activeTenantId);
      const { data, error } = await supabase
        .from("location_labels")
        .select("*")
        .eq("tenant_id", activeTenantId)
        .eq("is_active", true)
        .order("position", { ascending: true });

      if (error) {
        if (
          isMissingLocationLabelsContract(error) ||
          isConfirmedNetworkUnavailable(error)
        ) {
          return cached;
        }
        throw new Error(error.message);
      }

      let labels = rowsToLocationLabels((data ?? []) as LocationLabelRow[]);

      // One-time rolling-deploy import. A previously server-synced empty list
      // is authoritative and must never resurrect stale device rows.
      if (
        labels.length === 0 &&
        cached.length > 0 &&
        role === "owner" &&
        !hasCachedLocationLabelsServerSync(activeTenantId)
      ) {
        const { data: migrated, error: migrateError } = await supabase.rpc(
          "apply_location_label_changes",
          { p_labels: locationLabelsToJson(cached), p_remove_ids: [] },
        );
        if (migrateError) {
          if (isMissingLocationLabelsContract(migrateError)) return cached;
          throw new Error(migrateError.message);
        }
        labels = rowsToLocationLabels(
          (migrated ?? []) as LocationLabelRow[],
        );
      }

      cacheServerLocationLabels(activeTenantId, labels);
      return labels;
    },
  });
}

export function useSaveLocationLabels() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (l: LocationLabel[]) => {
      if (!tenantId) throw new Error("Нет активной компании");
      if (role !== "owner") {
        throw new Error("Настраивать типы объектов может только владелец.");
      }
      const normalized = l.map((label) => ({
        id: label.id.trim(),
        name: label.name.trim(),
      }));
      const cacheKey = [
        "location-labels",
        tenantId,
        role ?? "role-pending",
      ] as const;
      const previous =
        qc.getQueryData<LocationLabel[]>(cacheKey) ??
        loadCachedLocationLabels(tenantId);
      const removeIds = locationLabelRemoveIds(previous, normalized);
      const upserts = positionedLocationLabelUpserts(previous, normalized);
      const { data, error } = await supabase.rpc(
        "apply_location_label_changes",
        {
          p_labels: locationLabelsToJson(upserts, normalized),
          p_remove_ids: removeIds,
        },
      );
      if (error) {
        // A missing rolling-deploy RPC is never a successful write. Keeping a
        // device-only edit here used to show “saved”, then lose it on the next
        // canonical refresh or on another phone.
        if (isMissingLocationLabelsContract(error)) {
          throw new Error(
            "Типы объектов ещё не подключены на сервере. Обновите серверную схему и повторите.",
          );
        }
        throw new Error(error.message);
      }
      const canonical = rowsToLocationLabels(
        (data ?? []) as LocationLabelRow[],
      );
      cacheServerLocationLabels(tenantId, canonical);
      return canonical;
    },
    onSuccess: (l) =>
      qc.setQueryData(
        ["location-labels", tenantId, role ?? "role-pending"],
        l,
      ),
    meta: { errorHandled: true },
  });
}

// ─── Personal event types (personal_event_types, row per type) ───────
type EventTypeRow = Database["public"]["Tables"]["personal_event_types"]["Row"];

function safeLoadPersonalEventTypes(): PersonalEventType[] {
  try {
    return loadPersonalEventTypes();
  } catch {
    return [...SEED_PERSONAL_EVENT_TYPES];
  }
}

function safeSavePersonalEventTypes(types: PersonalEventType[]): void {
  try {
    savePersonalEventTypes(types);
  } catch {
    // Canonical query data remains usable even if MMKV is unavailable.
  }
}

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
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["event-types", tenantId, role ?? "role-pending"],
    enabled:
      !!tenantId &&
      roleQuery.isSuccess &&
      (role === "owner" || role === "dispatcher"),
    networkMode: "always",
    queryFn: async (): Promise<PersonalEventType[]> => {
      const cached = safeLoadPersonalEventTypes();
      const activeTenantId = tenantId as string;
      try {
        // Fetch ALL rows (active + soft-deleted): an empty ACTIVE set is
        // ambiguous — «never synced» (→ device seeds) vs «user deleted
        // every type» (→ []). Soft-deleted rows prove the table has synced,
        // so the seeds must not resurrect.
        const { data, error } = await supabase
          .from("personal_event_types")
          .select("*")
          .eq("tenant_id", activeTenantId)
          .order("position");
        if (error) throw serverOperationError("usePersonalEventTypes", error);
        if ((data ?? []).length > 0) {
          const list = (data ?? [])
            .filter((row) => row.is_active)
            .map(rowToEventType);
          safeSavePersonalEventTypes(list);
          return list;
        }
        // No rows at all — the local cache/seeds bootstrap the first save.
        return cached;
      } catch (error) {
        const readError = asServerReadError(error);
        if (
          isConfirmedNetworkUnavailable(readError) ||
          isMissingPersonalEventTypesContract(readError)
        ) {
          return cached;
        }
        throw error;
      }
    },
  });
}

export function useSavePersonalEventTypes() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  const mutationKey = [
    "event-types",
    tenantId,
    role ?? "role-pending",
  ] as const;
  return useMutation({
    mutationKey,
    networkMode: "always",
    // The cabinet exposes one editor. Serial execution prevents two rapid
    // full-snapshot writes from reactivating a row the adjacent delete just
    // soft-retired; the screen also disables destructive taps while pending.
    scope: { id: `personal-event-types:${tenantId ?? "no-tenant"}` },
    mutationFn: async ({
      types,
      removeIds = [],
    }: {
      types: PersonalEventType[];
      /** Ids the user explicitly deleted in THIS action. */
      removeIds?: string[];
    }) => {
      if (!tenantId) throw new Error("Нет активной компании");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Роль сотрудника не позволяет менять типы событий.");
      }
      let list = types;
      const retiredSeedIds: string[] = [];
      // The fixed seed ids are identical for every user, while rows are
      // author-scoped. Re-key deterministically before the first server save.
      const seedIds = new Set(SEED_PERSONAL_EVENT_TYPES.map((s) => s.id));
      if (types.some((t) => seedIds.has(t.id))) {
        const { data: auth, error: authError } = await supabase.auth.getSession();
        if (authError) {
          throw serverOperationError("useSavePersonalEventTypes", authError);
        }
        const uid = auth.session?.user.id;
        if (!uid) throw new Error("Сессия пользователя недоступна");
        list = types.map((t) => {
          if (!seedIds.has(t.id)) return t;
          retiredSeedIds.push(t.id);
          return { ...t, id: `pet-${uid}-${t.id}` };
        });
      }

      if (list.length > 0) {
        const { data, error } = await supabase
          .from("personal_event_types")
          .upsert(
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
          )
          .select("id");
        if (error) {
          throw serverOperationError("useSavePersonalEventTypes", error);
        }
        const confirmedIds = new Set((data ?? []).map((row) => row.id));
        if (list.some((type) => !confirmedIds.has(type.id))) {
          throw new Error("Сохранение типов событий не подтверждено сервером");
        }
      }
      // Soft-delete only explicit removals plus this user's retired seed ids.
      const gone = [...new Set([...removeIds, ...retiredSeedIds])];
      if (gone.length > 0) {
        const { error: deleteError } = await supabase
          .from("personal_event_types")
          .update({ is_active: false })
          .eq("tenant_id", tenantId)
          .in("id", gone);
        if (deleteError) {
          throw serverOperationError(
            "useSavePersonalEventTypes",
            deleteError,
          );
        }
      }
      return list;
    },
    onSuccess: (types) => {
      // Cache writes happen only after every canonical server write succeeds.
      safeSavePersonalEventTypes(types);
      qc.setQueryData(mutationKey, types);
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) {
        void qc.invalidateQueries({ queryKey: mutationKey });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
