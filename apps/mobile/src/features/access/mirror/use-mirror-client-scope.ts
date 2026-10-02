import { useQuery } from "@tanstack/react-query";

import { tenantBoundClient } from "@/lib/tenant-bound-client";

import type { MemberAccessMap } from "../access-map";
import {
  mirrorOpenTeams,
  mirrorView,
  shiftMonth,
  type MirrorScopeAppointment,
  type MirrorView,
} from "./mirror-client";
import { useMirror } from "./mirror-state";

// НАБОР КЛИЕНТОВ ЗЕРКАЛА — ИЗ БАЗЫ, А НЕ ИЗ КЭША КАЛЕНДАРЯ. Окно записи
// (месяц назад — месяц вперёд, 02.10) читается у всех его команд: из него же
// «2 недели», «Месяц» и номер «В день записи»; всё время — только у «Своей команды».
// Кэш календаря держит то, что открывали, и набор по нему гулял бы от
// прокрутки. Читает токен владельца: ему таблицы открыты, писать нечего.
//
// Ключ — с головой `mirror-client-scope`: выход из режима его стирает
// (`mirror-cache.ts`).

const PAGE = 1000;

/** Ни одной команды с карточками — набор пуст и без запроса. */
const EMPTY_VIEW: MirrorView = { teams: new Map(), dayToday: new Set() };

type Page = PromiseLike<{
  data: MirrorScopeAppointment[] | null;
  error: { message: string } | null;
}>;

async function readAll(page: (from: number, to: number) => Page): Promise<MirrorScopeAppointment[]> {
  const out: MirrorScopeAppointment[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`mirrorClientScope: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Набор клиентов человека в зеркале по командам; `undefined` — зеркала нет
 *  или набор ещё едет (список тогда пуст — закрыто, пока не посчитано). */
export function useMirrorClientScope(map: MemberAccessMap | null): MirrorView | undefined {
  const userId = useMirror()?.userId ?? null;
  const teams = map ? mirrorOpenTeams(map) : null;
  const query = useQuery({
    // Номер «В день записи» тоже решает набор — уровни «Телефона» в ключе.
    queryKey: [
      "mirror-client-scope",
      map?.tenantId ?? "",
      userId ?? "",
      JSON.stringify(map?.calendars ?? {}),
    ],
    enabled: !!map && !!teams && teams.length > 0,
    queryFn: async (): Promise<MirrorView> => {
      const accessMap = map as MemberAccessMap;
      const tenantId = accessMap.tenantId;
      const open = (teams as NonNullable<typeof teams>).map((team) => team.teamId);
      const own = (teams as NonNullable<typeof teams>)
        .filter((team) => team.scope === "own")
        .map((team) => team.teamId);
      const db = tenantBoundClient(tenantId);
      const day = await db.rpc("tenant_business_date", { p_tenant_id: tenantId });
      if (day.error || !day.data) throw new Error(`mirrorClientScope: ${day.error?.message ?? "нет даты"}`);
      const today = day.data;
      const columns = "client_id, team_id, date, status";
      const [window, wide, mine] = await Promise.all([
        readAll((from, to) =>
          db
            .from("appointments")
            .select(columns)
            .eq("tenant_id", tenantId)
            .in("team_id", open)
            .gte("date", shiftMonth(today, -1))
            .lte("date", shiftMonth(today, 1))
            .not("client_id", "is", null)
            .order("id")
            .range(from, to) as unknown as Page,
        ),
        own.length === 0
          ? Promise.resolve([])
          : readAll((from, to) =>
              db
                .from("appointments")
                .select(columns)
                .eq("tenant_id", tenantId)
                .in("team_id", own)
                .not("client_id", "is", null)
                .order("id")
                .range(from, to) as unknown as Page,
            ),
        userId
          ? db
              .from("clients")
              .select("id")
              .eq("tenant_id", tenantId)
              // `created_by` в сгенерированных типах пока нет — фильтр строкой.
              .filter("created_by", "eq", userId)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] as { id: string }[], error: null }),
      ]);
      if (mine.error) throw new Error(`mirrorClientScope: ${mine.error.message}`);
      return mirrorView(accessMap, {
        appointments: [...window, ...wide],
        createdBy: (mine.data ?? []).map((row) => row.id),
        today,
      });
    },
  });
  if (map && teams && teams.length === 0) return EMPTY_VIEW;
  return map ? query.data : undefined;
}
