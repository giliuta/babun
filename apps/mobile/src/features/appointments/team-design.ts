import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RecordColorPalette,
  RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import { getStorage } from "@babun/shared/storage";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";

// «ДИЗАЙН» КОМАНДЫ (владелец 2026-09-24: «всё отдельно под каждую команду»;
// миграция 20260924233000_team_design). Одна строка `team_design` на команду:
// правило цвета, палитра «чего не хватает», запасной цвет и выключенные блоки
// формы записи и события. Читают все члены компании, правит владелец.
//
// ПОКА СТРОКИ НЕТ (миграция не накачена, команда только что заведена, нет
// сети и кэша) — `null`, и `booking-prefs` берёт прежние настройки компании.
// Так переезд не ломает ни одного экрана.

export type TeamBlockKey =
  | "record_label"
  | "record_object"
  | "record_payment"
  | "record_note"
  | "record_files"
  | "event_label"
  | "event_type"
  | "event_client"
  | "event_object"
  | "event_note"
  | "event_files";

export interface TeamDesign {
  rule: RecordColorRule;
  palette: RecordColorPalette | null;
  fallback: string | null;
  disabledBlocks: TeamBlockKey[];
}

type Row = {
  team_id: string;
  record_color_rule: RecordColorRule | null;
  record_color_palette: RecordColorPalette | null;
  record_color_fallback: string | null;
  disabled_blocks: string[] | null;
};

// Таблицы ещё нет в сгенерированных типах (database.types.ts отстаёт от
// миграций) — узкая обёртка вместо `any`.
type Query = {
  select: (cols: string) => {
    eq: (col: string, v: string) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
  };
  upsert: (
    row: Record<string, unknown>,
    opts: { onConflict: string },
  ) => Promise<{ error: { message: string } | null }>;
};
const table = () =>
  (supabase as unknown as { from: (t: string) => Query }).from("team_design");

const cacheKey = (tenantId: string) => `babun-team-design:${tenantId}`;

function toDesign(row: Row): TeamDesign {
  return {
    rule: row.record_color_rule ?? "team",
    palette: row.record_color_palette ?? null,
    fallback: row.record_color_fallback ?? null,
    disabledBlocks: (row.disabled_blocks ?? []) as TeamBlockKey[],
  };
}

type DesignMap = Record<string, TeamDesign>;

function readCache(tenantId: string | null): DesignMap | undefined {
  if (!tenantId) return undefined;
  try {
    return getStorage().get<DesignMap>(cacheKey(tenantId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function teamDesignQueryKey(tenantId: string | null) {
  return ["team-design", tenantId] as const;
}

/** Все «Дизайны» команд компании: teamId → настройки. */
export function useTeamDesigns() {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  return useQuery({
    queryKey: teamDesignQueryKey(tenantId),
    enabled: !!tenantId && roleQuery.isSuccess && roleQuery.data != null,
    networkMode: "always",
    placeholderData: () => readCache(tenantId),
    queryFn: async (): Promise<DesignMap> => {
      const { data, error } = await table()
        .select(
          "team_id, record_color_rule, record_color_palette, record_color_fallback, disabled_blocks",
        )
        .eq("tenant_id", tenantId as string);
      if (error) {
        // Таблицы ещё нет (миграция не накачена) или нет сети — живём на
        // кэше, а без него на настройках компании.
        return readCache(tenantId) ?? {};
      }
      const map: DesignMap = {};
      for (const row of data ?? []) map[row.team_id] = toDesign(row);
      try {
        getStorage().set(cacheKey(tenantId as string), map);
      } catch {
        /* кэш не обязателен */
      }
      return map;
    },
  });
}

/** «Дизайн» одной команды или `null`, если строки нет. */
export function useTeamDesign(teamId: string | null | undefined): TeamDesign | null {
  const { data } = useTeamDesigns();
  if (!teamId || !data) return null;
  return data[teamId] ?? null;
}

/** Правка «Дизайна» команды — патчем, мгновенно на экране (владелец). */
export function useSaveTeamDesign() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const key = teamDesignQueryKey(tenantId);
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: { teamId: string; next: TeamDesign }) => {
      if (!tenantId) throw new Error("Нет активной компании");
      const { error } = await table().upsert(
        {
          tenant_id: tenantId,
          team_id: input.teamId,
          record_color_rule: input.next.rule,
          record_color_palette: input.next.palette,
          record_color_fallback: input.next.fallback,
          disabled_blocks: input.next.disabledBlocks,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,team_id" },
      );
      if (error) throw new Error(error.message);
      return input;
    },
    onMutate: async ({ teamId, next }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DesignMap>(key);
      qc.setQueryData<DesignMap>(key, { ...(prev ?? {}), [teamId]: next });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: () => {
      const map = qc.getQueryData<DesignMap>(key);
      if (map && tenantId) {
        try {
          getStorage().set(cacheKey(tenantId), map);
        } catch {
          /* кэш не обязателен */
        }
      }
    },
  });
}
