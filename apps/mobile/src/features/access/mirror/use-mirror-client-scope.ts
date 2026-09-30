import { useQuery } from "@tanstack/react-query";

import { tenantBoundClient } from "@/lib/tenant-bound-client";

import type { MemberAccessMap } from "../access-map";
import {
  mirrorClientScope,
  mirrorScopeTeams,
  shiftDay,
  type MirrorClientScope,
  type MirrorScopeAppointment,
} from "./mirror-client";
import { useMirror } from "./mirror-state";

// НАБОР КЛИЕНТОВ ЗЕРКАЛА — ИЗ БАЗЫ, А НЕ ИЗ КЭША КАЛЕНДАРЯ. Окно «Около
// записи» считается по записям команд сотрудника за неделю назад и завтра, а
// «Своей команды» — по всем записям команды. Кэш календаря держит то, что
// открывали, и набор по нему гулял бы от прокрутки. Читает токен владельца:
// ему таблицы открыты, писать зеркалу нечего.
//
// Ключ — с головой `mirror-client-scope`: выход из режима его стирает
// (`mirror-cache.ts`).

const PAGE = 1000;

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

/** Набор клиентов человека в зеркале; `undefined` — зеркала нет или набор
 *  ещё едет (список тогда пуст — закрыто, пока не посчитано). */
export function useMirrorClientScope(map: MemberAccessMap | null): MirrorClientScope | undefined {
  const userId = useMirror()?.userId ?? null;
  const teams = map ? mirrorScopeTeams(map) : null;
  const query = useQuery({
    queryKey: ["mirror-client-scope", map?.tenantId ?? "", userId ?? "", JSON.stringify(teams)],
    enabled: !!map && !!teams,
    queryFn: async (): Promise<MirrorClientScope> => {
      const tenantId = (map as MemberAccessMap).tenantId;
      const scopeTeams = teams as NonNullable<typeof teams>;
      const db = tenantBoundClient(tenantId);
      const day = await db.rpc("tenant_business_date", { p_tenant_id: tenantId });
      if (day.error || !day.data) throw new Error(`mirrorClientScope: ${day.error?.message ?? "нет даты"}`);
      const today = day.data;
      const columns = "client_id, team_id, date, status";
      const [near, wide, mine] = await Promise.all([
        scopeTeams.near.length === 0 || scopeTeams.whole
          ? Promise.resolve([])
          : readAll((from, to) =>
              db
                .from("appointments")
                .select(columns)
                .eq("tenant_id", tenantId)
                .in("team_id", scopeTeams.near)
                .gte("date", shiftDay(today, -7))
                .lte("date", shiftDay(today, 1))
                .not("client_id", "is", null)
                .order("id")
                .range(from, to) as unknown as Page,
            ),
        scopeTeams.teamWide.length === 0 || scopeTeams.whole
          ? Promise.resolve([])
          : readAll((from, to) =>
              db
                .from("appointments")
                .select(columns)
                .eq("tenant_id", tenantId)
                .in("team_id", scopeTeams.teamWide)
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
      return mirrorClientScope(scopeTeams, {
        appointments: [...near, ...wide],
        createdBy: (mine.data ?? []).map((row) => row.id),
        today,
      });
    },
  });
  return map ? query.data : undefined;
}
