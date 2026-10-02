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

// НАБОР КЛИЕНТОВ ЗЕРКАЛА — ИЗ БАЗЫ, А НЕ ИЗ КЭША КАЛЕНДАРЯ. Видны только
// клиенты его команд (02.10); записи (месяц назад — месяц вперёд) читаются у
// команд с «Ограничением по времени» — из них «2 недели» и «Месяц».
// Кэш календаря держит то, что открывали, и набор по нему гулял бы от
// прокрутки. Читает токен владельца: ему таблицы открыты, писать нечего.
//
// Ключ — с головой `mirror-client-scope`: выход из режима его стирает
// (`mirror-cache.ts`).

const PAGE = 1000;

/** Ни одной команды с карточками — набор пуст и без запроса. */
const EMPTY_VIEW: MirrorView = { teams: new Map() };

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
    // Набор решают уровни команд — карта прав в ключе.
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
      // Видны только клиенты команды (02.10); записи нужны лишь командам с
      // «Ограничением по времени» — «Без ограничения» решает сама команда клиента.
      const windowed = (teams as NonNullable<typeof teams>)
        .filter((team) => team.scope === "near" || team.scope === "month")
        .map((team) => team.teamId);
      if (windowed.length === 0) return mirrorView(accessMap, { appointments: [], today: "" });
      const db = tenantBoundClient(tenantId);
      const day = await db.rpc("tenant_business_date", { p_tenant_id: tenantId });
      if (day.error || !day.data) throw new Error(`mirrorClientScope: ${day.error?.message ?? "нет даты"}`);
      const today = day.data;
      const appointments = await readAll((from, to) =>
        db
          .from("appointments")
          .select("client_id, team_id, date, status")
          .eq("tenant_id", tenantId)
          .in("team_id", windowed)
          .gte("date", shiftMonth(today, -1))
          .lte("date", shiftMonth(today, 1))
          .not("client_id", "is", null)
          .order("id")
          .range(from, to) as unknown as Page,
      );
      return mirrorView(accessMap, { appointments, today });
    },
  });
  if (map && teams && teams.length === 0) return EMPTY_VIEW;
  return map ? query.data : undefined;
}
