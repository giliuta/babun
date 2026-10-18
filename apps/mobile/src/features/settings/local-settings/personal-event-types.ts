import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import {
  loadPersonalEventTypes,
  savePersonalEventTypes,
  type PersonalEventType,
  type PersonalEventTypeIcon,
} from "@babun/shared/local/personal-event-types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
// The data role, not the mirrored one — see the note in ./calendar-settings.
import { useDataRole } from "@/session/tenant";
import {
  isConfirmedNetworkUnavailable,
  isMissingPersonalEventTypesContract,
} from "@/lib/server-read-fallback";
import { asServerReadError, serverOperationError } from "./server-error";

// ─── Personal event types (personal_event_types, row per type) ───────
type EventTypeRow = Database["public"]["Tables"]["personal_event_types"]["Row"];

function safeLoadPersonalEventTypes(tenantId: string | null): PersonalEventType[] {
  if (!tenantId) return [];
  try {
    return loadPersonalEventTypes(tenantId);
  } catch {
    return [];
  }
}

function safeSavePersonalEventTypes(
  types: PersonalEventType[],
  tenantId: string,
): void {
  try {
    savePersonalEventTypes(types, tenantId);
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
    hidden: !r.is_active,
    ...(r.team_id ? { teamId: r.team_id } : {}),
  };
}

/** Типы событий КОМАНДЫ (у каждой команды свои). Запрос
 *  несёт справочник всей компании одним ключом, команда — `select`, как у
 *  меток: смена команды не гонит новый запрос. Тип без команды (старый кэш
 *  до миграции 20260924233000) виден всем командам, пока не перечитан. */
export function usePersonalEventTypes(teamId?: string | null) {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  const role = roleQuery.data;
  const select = useCallback(
    (list: PersonalEventType[]) =>
      teamId ? list.filter((type) => !type.teamId || type.teamId === teamId) : list,
    [teamId],
  );
  return useQuery({
    queryKey: ["event-types", tenantId, role ?? "role-pending"],
    select,
    // Читают все члены компании; правят владелец и диспетчер (RLS).
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    networkMode: "always",
    // ЛЕНТА ТИПОВ РИСУЕТСЯ СРАЗУ, А НЕ ПОСЛЕ ОТВЕТА СЕРВЕРА. Форма события
    // открывается мгновенно, а запрос ждёт и роль, и сеть: секунду-полторы на
    // месте блока была бы пустота, и человек решил бы, что типов нет.
    //
    // Кэш на устройстве держит ровно тот же список (его пишет каждое
    // успешное сохранение), поэтому он и есть первый кадр. `placeholderData`,
    // а не `initialData`: запрос всё равно уходит и заменяет список свежим,
    // просто человек этого не видит.
    placeholderData: () => safeLoadPersonalEventTypes(tenantId),
    queryFn: async (): Promise<PersonalEventType[]> => {
      const activeTenantId = tenantId as string;
      const cached = safeLoadPersonalEventTypes(activeTenantId);
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
          // СКРЫТЫЕ ЕДУТ ВМЕСТЕ С ЖИВЫМИ: справочник
          // показывает их серой строкой и возвращает одним касанием. Форма
          // события отбирает `!hidden` сама — фильтр в запросе оставил бы
          // экран настроек без того, чем он управляет. Удалённые (у них своя
          // колонка `deleted_at`) не приезжают вовсе.
          const list = (data ?? [])
            .filter((row) => row.deleted_at == null)
            .map(rowToEventType);
          safeSavePersonalEventTypes(list, activeTenantId);
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
  const role = useDataRole().data;
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
      teamId,
    }: {
      /** Типы ОДНОЙ команды — её полный список в порядке показа. */
      types: PersonalEventType[];
      /** Ids the user explicitly deleted in THIS action. */
      removeIds?: string[];
      /** Команда, чьи это типы. */
      teamId: string;
    }) => {
      if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
      // Сотрудник — по праву «Записи» своей команды: чужую команду
      // отобьёт политика `personal_event_types_write_access`.
      if (role !== "owner" && role !== "dispatcher" && role !== "master") {
        throw new Error("Ваша роль не позволяет менять типы событий.");
      }
      // Заготовок с общими id нет — перекладывать нечего.
      const list = types;

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
              is_active: !t.hidden,
              team_id: teamId,
              // Строка возвращается из удалённых, если её id снова сохранили:
              // «Показать» у скрытой и повторное заведение того же типа
              // должны воскрешать одну и ту же запись, а не спорить с ней.
              deleted_at: null,
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
      // Soft-delete only explicit removals.
      const gone = [...new Set(removeIds)];
      if (gone.length > 0) {
        const { error: deleteError } = await supabase
          .from("personal_event_types")
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .in("id", gone);
        if (deleteError) {
          throw serverOperationError(
            "useSavePersonalEventTypes",
            deleteError,
          );
        }
      }
      return { list: list.map((t) => ({ ...t, teamId })), teamId, tenantId };
    },
    // ОПТИМИСТИЧНО (без этого создание типа крутится секундами): список на
    // экране меняется сразу, сервер догоняет; отказ возвращает прежний.
    onMutate: async ({ types, teamId }) => {
      await qc.cancelQueries({ queryKey: mutationKey });
      const prev = qc.getQueryData<PersonalEventType[]>(mutationKey);
      const all = prev ?? [];
      qc.setQueryData<PersonalEventType[]>(mutationKey, [
        ...all.filter((t) => t.teamId && t.teamId !== teamId),
        ...types.map((t) => ({ ...t, teamId })),
      ]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(mutationKey, ctx.prev);
    },
    onSuccess: ({ list, teamId, tenantId: savedTenantId }) => {
      // Cache writes happen only after every canonical server write succeeds.
      // В кэше справочник ВСЕЙ компании: заменяем типы только этой команды.
      const all = qc.getQueryData<PersonalEventType[]>(mutationKey) ?? [];
      const next = [...all.filter((t) => t.teamId && t.teamId !== teamId), ...list];
      safeSavePersonalEventTypes(next, savedTenantId);
      qc.setQueryData(mutationKey, next);
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) {
        void qc.invalidateQueries({ queryKey: mutationKey });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
