import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RecordColorPalette,
  RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import { getStorage } from "@babun/shared/storage";
import { changedDesignColumns, designColumns } from "./team-design-columns";
import { supabase } from "@/lib/supabase";
import { useScopeCompany } from "@/features/clients/company-scope";

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
  | "event_files"
  // Функции клиентов команды (владелец 30.09: «люди, связи, реквизиты,
  // файлы — всё закреплено за командой»).
  | "client_people"
  | "client_requisites"
  | "client_files"
  | "client_note"
  | "client_objects"
  | "client_labels"
  | "client_personal"
  // «Тег» отдельно от «Метки» (владелец 03.10).
  | "client_tags";

/** Упорядоченный набор «что предлагать»: включённые и полный порядок. */
export interface TeamOrderedSet {
  enabled: string[];
  order: string[];
}

export interface TeamDesign {
  rule: RecordColorRule;
  palette: RecordColorPalette | null;
  fallback: string | null;
  disabledBlocks: TeamBlockKey[];
  // ВИД КЛИЕНТОВ КОМАНДЫ НА СЕРВЕРЕ (миграция 20260930232000). `null` — команда
  // на сервере ещё не настраивала: берётся набор с телефона.
  /** Выключенные поля строки списка клиентов. */
  listOff?: string[] | null;
  /** «Способы связи». */
  contactWays?: TeamOrderedSet | null;
  /** «Карты для маршрута». */
  mapServices?: TeamOrderedSet | null;
}

type Row = {
  team_id: string;
  record_color_rule: RecordColorRule | null;
  record_color_palette: RecordColorPalette | null;
  record_color_fallback: string | null;
  disabled_blocks: string[] | null;
  client_list_off?: string[] | null;
  contact_ways?: TeamOrderedSet | null;
  map_services?: TeamOrderedSet | null;
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
  update: (row: Record<string, unknown>) => {
    eq: (col: string, v: string) => {
      eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};
/** Таблица — клиентом компании экрана: у партнёра и у владельца с чужим
 *  календарём это привязанный клиент (`useScopeCompany`). */
const table = (client: typeof supabase) =>
  (client as unknown as { from: (t: string) => Query }).from("team_design");

const cacheKey = (tenantId: string) => `babun-team-design:${tenantId}`;

function toDesign(row: Row): TeamDesign {
  return {
    rule: row.record_color_rule ?? "team",
    palette: row.record_color_palette ?? null,
    fallback: row.record_color_fallback ?? null,
    disabledBlocks: (row.disabled_blocks ?? []) as TeamBlockKey[],
    listOff: row.client_list_off ?? null,
    contactWays: row.contact_ways ?? null,
    mapServices: row.map_services ?? null,
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
  // КОМПАНИЯ ЭКРАНА, А НЕ КАЛЕНДАРЯ (01.10): настройки клиентов команды
  // работодателя партнёр правит из своей вкладки, не переключая календарь.
  // Вне вкладки «Клиенты» это та же активная компания, что и раньше.
  const { tenantId, client, role, foreign } = useScopeCompany();
  return useQuery({
    queryKey: teamDesignQueryKey(tenantId),
    enabled: !!tenantId && role != null,
    networkMode: "always",
    placeholderData: () => (foreign ? undefined : readCache(tenantId)),
    queryFn: async (): Promise<DesignMap> => {
      const { data, error } = await table(client)
        .select(
          "team_id, record_color_rule, record_color_palette, record_color_fallback, disabled_blocks, client_list_off, contact_ways, map_services",
        )
        .eq("tenant_id", tenantId as string);
      if (error) {
        // Таблицы ещё нет (миграция не накачена) или нет сети — живём на
        // кэше, а без него на настройках компании.
        return (foreign ? undefined : readCache(tenantId)) ?? {};
      }
      const map: DesignMap = {};
      for (const row of data ?? []) map[row.team_id] = toDesign(row);
      // Чужая компания на диск не ложится — только в памяти.
      if (!foreign) {
        try {
          getStorage().set(cacheKey(tenantId as string), map);
        } catch {
          /* кэш не обязателен */
        }
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
  const { tenantId, client, foreign } = useScopeCompany();
  const qc = useQueryClient();
  const key = teamDesignQueryKey(tenantId);
  // Что было на экране у команды перед правкой: `onMutate` идёт раньше
  // записи и успевает положить сюда снимок до своей оптимистичной подмены.
  const before = useRef(new Map<string, TeamDesign | null>());
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: { teamId: string; next: TeamDesign }) => {
      if (!tenantId) throw new Error("Нет активной компании");
      const was = before.current.get(input.teamId) ?? null;
      before.current.delete(input.teamId);
      const stamp = { updated_at: new Date().toISOString() };
      if (was) {
        // Строка на сервере есть — уходят только изменённые колонки.
        const patch = changedDesignColumns(was, input.next);
        if (Object.keys(patch).length === 0) return input;
        const { error } = await table(client)
          .update({ ...patch, ...stamp })
          .eq("tenant_id", tenantId)
          .eq("team_id", input.teamId);
        if (error) throw new Error(error.message);
        return input;
      }
      // Строки ещё нет — первая правка команды заводит её целиком.
      const { error } = await table(client).upsert(
        { tenant_id: tenantId, team_id: input.teamId, ...designColumns(input.next), ...stamp },
        { onConflict: "tenant_id,team_id" },
      );
      if (error) throw new Error(error.message);
      return input;
    },
    onMutate: async ({ teamId, next }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DesignMap>(key);
      before.current.set(teamId, prev?.[teamId] ?? null);
      qc.setQueryData<DesignMap>(key, { ...(prev ?? {}), [teamId]: next });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: () => {
      const map = qc.getQueryData<DesignMap>(key);
      if (map && tenantId && !foreign) {
        try {
          getStorage().set(cacheKey(tenantId), map);
        } catch {
          /* кэш не обязателен */
        }
      }
    },
  });
}
