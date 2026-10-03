import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { useClientsCapabilities, useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useClientFunctionOn } from "@/features/clients/client-functions";
import { useFeatureOn } from "@/features/settings/company-features";
import { cardAccess, type CardAccess } from "@/features/clients/card-access";
import { useMyAccess } from "@/features/access/queries";
import { parseMemberAccessMap, type MemberAccessMap } from "@/features/access/access-map";
import { mirrorClientBlocks } from "@/features/access/mirror/mirror-client";
import { myAccessQueryKey } from "@/lib/company-query-keys";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { usePlanAllows } from "@/features/settings/tenant";

/** Карта прав сотрудника в компании источника: активной — `useMyAccess`
 *  (в зеркале уже подменена), работодателя вне активной — тем же ключом через
 *  привязанный клиент (как `sources.ts`). Своя база — `null`. */
function useScopeAccessMap(): MemberAccessMap | null {
  const scope = useClientsScopeOrNull();
  const active = useMyAccess().data ?? null;
  const foreignId = scope?.kind === "member" && !scope.isActive ? scope.tenantId : null;
  const foreign = useQuery({
    queryKey: myAccessQueryKey(foreignId),
    enabled: !!foreignId,
    networkMode: "always",
    staleTime: 60_000,
    queryFn: async (): Promise<MemberAccessMap> => {
      const { data, error } = await tenantBoundClient(foreignId as string).rpc("my_access_map");
      if (error) throw new Error(`my_access_map: ${error.message}`);
      return parseMemberAccessMap(data);
    },
  });
  if (scope?.kind !== "member") return null;
  return scope.isActive ? active : (foreign.data ?? null);
}

/** Блоки карточки этого клиента: видно ли и правится ли (`card-access.ts`). */
export function useCardAccess(client: Client | null | undefined, draft: boolean): CardAccess {
  const caps = useClientsCapabilities();
  const teamId = client?.team_id ?? null;
  // Объекты выключаются ещё и у компании — оба выключателя складываются.
  const objectsCompany = useFeatureOn("objects");
  const note = useClientFunctionOn("client_note", teamId);
  const people = useClientFunctionOn("client_people", teamId);
  const objects = useClientFunctionOn("client_objects", teamId);
  const labels = useClientFunctionOn("client_labels", teamId);
  const tags = useClientFunctionOn("client_tags", teamId);
  const personal = useClientFunctionOn("client_personal", teamId);
  const files = useClientFunctionOn("client_files", teamId);
  const requisites = useClientFunctionOn("client_requisites", teamId);
  const blocks = client?.blocks;
  // Черновик сотрудника: положения по его карте прав и команде черновика; без
  // команды сервер кладёт клиента в первую, где «Карточки клиентов: Меняет».
  const accessMap = useScopeAccessMap();
  const draftTeam = client?.team_id ?? null;
  const draftBlocks = useMemo(() => {
    if (!draft || !accessMap || accessMap.isOwner) return null;
    const team =
      draftTeam ??
      Object.entries(accessMap.calendars).find(([, levels]) => levels.clients === "write")?.[0] ??
      null;
    return mirrorClientBlocks({ team_id: team }, accessMap);
  }, [draft, accessMap, draftTeam]);
  // БЕЗ ТАРИФА СВОЯ БАЗА — ТОЛЬКО ДЛЯ ПРОСМОТРА (владелец 02.10: «если клиент
  // заведён раньше — становится серым, редактировать нельзя»). Карточка
  // открывается, блоки на месте, правки нет — сервер держит то же
  // (`tenant_free_readonly_guard`). Чужая база партнёра — по тарифу её
  // владельца, её держит сервер.
  const scope = useClientsScopeOrNull();
  const frozen = !usePlanAllows("clients") && scope?.kind !== "member";
  return useMemo(
    () => {
      const access = cardAccess({
        client: blocks ? { blocks } : null,
        caps,
        teamOn: {
          note,
          people,
          objects: objectsCompany && objects,
          labels,
          tags,
          personal,
          files,
          requisites,
        },
        draft,
        draftBlocks,
      });
      if (!frozen) return access;
      return Object.fromEntries(
        Object.entries(access).map(([key, block]) => [key, { show: block.show, edit: false }]),
      ) as CardAccess;
    },
    [frozen, draftBlocks, blocks, caps, note, people, objectsCompany, objects, labels, tags, personal, files, requisites, draft],
  );
}
