import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import {
  hasLocationLabelsServerSync,
  loadLocationLabels,
  markLocationLabelsServerSynced,
  saveLocationLabels,
  type LocationLabel,
} from "@babun/shared/local/location-labels";
import { supabase } from "@/lib/supabase";
import { useScopeCompany } from "@/session/company-scope";
import {
  locationLabelRemoveIds,
  positionedLocationLabelUpserts,
} from "@/features/settings/location-label-sync";
import { isConfirmedNetworkUnavailable } from "@/lib/server-read-fallback";

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
    .map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color ?? null,
      icon: row.icon ?? null,
      teamId: row.team_id ?? null,
    }));
}

/** ТИПЫ ОБЪЕКТОВ КОМАНДЫ. Без команды — имена всей компании без
 *  повторов (у каждой команды своя «Вилла»); строки старого кэша команды не
 *  знают и видны всем. */
export function locationLabelsOfTeam(
  labels: readonly LocationLabel[],
  teamId: string | null,
): LocationLabel[] {
  if (teamId) return labels.filter((label) => !label.teamId || label.teamId === teamId);
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      // Пустое значение отправляем строкой «»: RPC приводит её к NULL. Так
      // снятие цвета доезжает до базы, а `undefined` просто выпал бы из JSON.
      color: label.color ?? "",
      icon: label.icon ?? "",
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

export function useLocationLabels(teamId: string | null = null) {
  // КОМПАНИЯ ЭКРАНА, А НЕ КАЛЕНДАРЯ: типы объектов команды
  // работодателя партнёр видит и правит из своей вкладки «Клиенты».
  const { tenantId, client, role, foreign } = useScopeCompany();
  return useQuery({
    queryKey: ["location-labels", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && role != null,
    staleTime: 5 * 60 * 1000,
    // Читается вся компания одним ключом, отдаётся — команда.
    select: (labels: LocationLabel[]) => locationLabelsOfTeam(labels, teamId),
    queryFn: async (): Promise<LocationLabel[]> => {
      const activeTenantId = tenantId as string;
      // Чужая компания на диск не ложится: ни читаем, ни пишем её кэш.
      const cached = foreign ? [] : loadCachedLocationLabels(activeTenantId);
      const { data, error } = await client
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
        !foreign &&
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

      if (!foreign) cacheServerLocationLabels(activeTenantId, labels);
      return labels;
    },
  });
}

export function useSaveLocationLabels(teamId: string | null = null) {
  const { tenantId, client, role, foreign } = useScopeCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (l: LocationLabel[]) => {
      if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
      // ПАРТНЁР ПРАВИТ ТИПЫ СВОЕЙ КОМАНДЫ ПО ПРАВУ «ТИПЫ ОБЪЕКТОВ»:
      // решает сервер (`apply_team_location_label_changes`). Общий
      // справочник компании без команды — по-прежнему только владельцу.
      if (role !== "owner" && !(teamId && role === "master")) {
        throw new Error("Настраивать типы объектов может только владелец.");
      }
      const normalized = l.map((label) => ({
        id: label.id.trim(),
        name: label.name.trim(),
        // Вид едет вместе с именем: без этих двух полей правка цвета и значка
        // доходила до RPC пустой, и справочник оставался серым.
        color: label.color ?? null,
        icon: label.icon ?? null,
      }));
      const cacheKey = [
        "location-labels",
        tenantId,
        role ?? "role-pending",
      ] as const;
      const all =
        qc.getQueryData<LocationLabel[]>(cacheKey) ??
        (foreign ? [] : loadCachedLocationLabels(tenantId));
      // Сравнивается и удаляется — только список ЭТОЙ команды.
      const previous = teamId ? all.filter((label) => label.teamId === teamId) : all;
      const removeIds = locationLabelRemoveIds(previous, normalized);
      const upserts = positionedLocationLabelUpserts(previous, normalized);
      const { data, error } = teamId
        ? await client.rpc("apply_team_location_label_changes", {
            p_team_id: teamId,
            p_labels: locationLabelsToJson(upserts, normalized),
            p_remove_ids: removeIds,
          })
        : await client.rpc("apply_location_label_changes", {
            p_labels: locationLabelsToJson(upserts, normalized),
            p_remove_ids: removeIds,
          });
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
      // Сервер вернул список команды — остальные команды в кэше не трогаем.
      const merged = teamId
        ? [...all.filter((label) => label.teamId !== teamId), ...canonical]
        : canonical;
      if (!foreign) cacheServerLocationLabels(tenantId, merged);
      return merged;
    },
    onSuccess: (l) =>
      qc.setQueryData(
        ["location-labels", tenantId, role ?? "role-pending"],
        l,
      ),
    meta: { errorHandled: true },
  });
}
