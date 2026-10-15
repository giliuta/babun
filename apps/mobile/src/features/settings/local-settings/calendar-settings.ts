import { useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  hasStoredCalendarSettings,
  loadCalendarSettings,
  loadOperationalCalendarSettings,
  saveCalendarSettings,
  saveOperationalCalendarSettings,
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { updateCalendarSettings } from "@babun/shared/db/repositories/calendar-settings";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
// РОЛЬ ЗДЕСЬ — СВОЯ (`useDataRole`), А НЕ ЗЕРКАЛЬНАЯ. Она входит в КЛЮЧ
// запроса и в форму чтения: на зеркальной роли каждый вход и выход из
// режима «его глазами» менял бы ключ, гнал холодную волну запросов, а строки
// владельца ложились бы под ключ «master» — тот самый, который потом возьмёт
// настоящий мастер на этом устройстве. Показ решает `useCurrentRole`.
import { useDataRole } from "@/session/tenant";
import { fetchCalendarSettings } from "@/session/company-fetchers";
import { calendarSettingsQueryKey } from "@/lib/company-query-keys";
import {
  isConfirmedNetworkUnavailable,
  isMissingCalendarSettingsContract,
} from "@/lib/server-read-fallback";
import {
  beginCalendarSave,
  confirmCalendarSave,
  createCalendarSaveState,
  currentCalendarSaveValue,
  rejectCalendarSave,
  type CalendarSaveState,
} from "@/features/settings/calendar-save-state";
import { asServerReadError } from "./server-error";

// ─── Calendar settings (calendar_settings, one row per tenant) ───────
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

function safeHasStoredCalendarSettings(): boolean {
  try {
    return hasStoredCalendarSettings();
  } catch {
    return false;
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
  const roleQuery = useDataRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: calendarSettingsQueryKey(tenantId, role),
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    networkMode: "always",
    queryFn: async (): Promise<CalendarSettings> => {
      const activeTenantId = tenantId as string;
      try {
        if (role !== "master" && role !== "owner" && role !== "dispatcher") {
          throw new Error("Роль в аккаунте ещё не подтверждена.");
        }
        const settings = await fetchCalendarSettings(
          supabase,
          activeTenantId,
          role,
        );
        // ЗАПИСЬ В MMKV — ЗДЕСЬ, А НЕ В ЧТЕНИИ: хук работает только для активной
        // компании, а прогрев чужой читает те же настройки через
        // `fetchCalendarSettings` и кэш устройства не трогает — иначе настройки
        // компании B легли бы под общий ключ и всплыли у A.
        // Копия по компании — у всех ролей: полная копия владельца лежит под
        // общим ключом, и переход в другую компанию её стирает. Без неё
        // компания, открытая без сети после перехода, рисовалась с заводскими
        // настройками — окно 00–24, отменённые видны.
        safeSaveOperationalCalendarSettings(activeTenantId, { ...settings });
        if (role !== "master") safeSaveCalendarSettings(settings);
        return settings;
      } catch (error) {
        if (!calendarReadMayUseCache(error)) throw error;
        return role !== "master" && safeHasStoredCalendarSettings()
          ? safeLoadCalendarSettings()
          : safeLoadOperationalCalendarSettings(activeTenantId);
      }
    },
  });
}

export function useSaveCalendarSettings() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
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
      if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
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
