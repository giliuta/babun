import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getClient } from "@babun/shared/db/repositories/clients";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import type { Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import {
  clientsQueryKey,
  sourceClientQueryKey,
  sourceClientsQueryKey,
} from "@/lib/company-query-keys";
import { inMirrorView, mirrorMemberClient } from "@/features/access/mirror/mirror-client";
import { useMirrorClientScope } from "@/features/access/mirror/use-mirror-client-scope";
import { isConfirmedNetworkUnavailable } from "@/features/settings/server-read-fallback";
import { listMasterClientsSafe, listMemberClients } from "./member-reads";
import { useMirroredMemberMap, useQueryScope } from "./scope";

export function useClient(id: string) {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  const qc = useQueryClient();
  // Тот же покров зеркала, что у списка: карточка — это тот же клиент,
  // открытый крупнее, и прятать только в списке значит не прятать вовсе.
  const mirrorMap = useMirroredMemberMap(scope.kind);
  // Клиент вне его набора сотруднику не приходит вовсе — и в зеркале тоже.
  const mirrorScope = useMirrorClientScope(mirrorMap);
  const mirrorOne = useCallback(
    (client: Client | null): Client | null => {
      if (!client || !mirrorMap) return client;
      if (mirrorScope && !inMirrorView(client, mirrorScope)) return null;
      return mirrorMemberClient(client, mirrorMap, mirrorScope);
    },
    [mirrorMap, mirrorScope],
  );
  return useQuery({
    queryKey: sourceClientQueryKey(id, tenantId, scope.view),
    enabled: !!tenantId && !!id && scope.ready,
    placeholderData: () => {
      const list = qc.getQueryData<Client[]>(
        scope.kind === "member"
          ? sourceClientsQueryKey(tenantId, scope.view)
          : clientsQueryKey(tenantId, scope.role),
      );
      const found = list?.find((client) => client.id === id);
      // Подстановка берёт строку из КЭША списка, а покров списка живёт в
      // `select` и кэш не меняет: без этого карточка мигала бы настоящим
      // телефоном до ответа сервера.
      return found && mirrorMap ? mirrorOne(found) : found;
    },
    queryFn: async () => {
      if (scope.kind === "record") {
        return (await listMasterClientsSafe(supabase, id))[0] ?? null;
      }
      if (scope.kind === "member") {
        const found = (await listMemberClients(tenantBoundClient(tenantId as string), id))[0];
        if (found || !scope.withRecordClients) return found ?? null;
        return (await listMasterClientsSafe(supabase, id))[0] ?? null;
      }
      try {
        return await getClient(tenantBoundClient(tenantId as string), id, tenantId as string);
      } catch (error) {
        const serverError =
          error && typeof error === "object"
            ? (error as { code?: string; message?: string })
            : { message: String(error) };
        if (!isConfirmedNetworkUnavailable(serverError)) throw error;
        // The list is offline-aware and may already have the complete domain
        // client in SQLite. A connection loss after opening the list should
        // therefore keep the card usable instead of becoming «not found».
        // Привязанным клиентом — разбор над `useClients`.
        const cached = await listClientsCached(
          tenantBoundClient(tenantId as string),
          tenantId as string,
        );
        const client = cached.find((item) => item.id === id);
        if (client) return client;
        throw error;
      }
    },
    select: mirrorMap ? mirrorOne : undefined,
  });
}
