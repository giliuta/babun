import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
// STORY-062 slice 5 — clients + tags READS now go through the shared
// offline-aware SWR wrappers (listClients / listClientTags). The two slice-4
// blockers are both closed:
//   1. cache-of-DOMAIN — the wrapper stores the FULL Client (tag_ids + nested
//      phones/locations/notes/equipment) and returns it whole, so the online
//      warm-cache read is byte-identical to a live repo read (no stripped-row
//      regression on the tag facet / filter / card meta);
//   2. revalidate bridge — the wrapper's background revalidate now prunes
//      server-deleted rows (cacheReplaceTenant) and, on a real change, fires
//      `revalidated`, which the realtime bridge (SyncBridgeMount) turns into a
//      react-query invalidate so the list re-reads the freshened cache.
// Offline the warm cache serves the last snapshot; a cold offline read is a
// typed blocking error, never a false empty customer base. `getClient` stays a direct repo read — the
// single-client card is not one of the three cached tables and must render the
// canonical row live.
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import type { Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { clientsQueryKey, sourceClientsQueryKey } from "@/lib/company-query-keys";
import { inMirrorView, mirrorMemberClient } from "@/features/access/mirror/mirror-client";
import { useMirrorClientScope } from "@/features/access/mirror/use-mirror-client-scope";
import { listMasterClientsSafe, listMemberClients, withRecordClients } from "./member-reads";
import { useMirroredMemberMap, useQueryScope } from "./scope";

// Clients list — SWR wrapper read (full domain shape incl. tag_ids, served
// from the SQLite cache when warm, then revalidated). RLS scopes rows to the
// tenant; we pass tenantId for the query key and the RLS/cache filter.
//
// ЧТЕНИЯ ЧЕРЕЗ SQLite-ОБЁРТКИ — КЛИЕНТОМ, ПРИВЯЗАННЫМ К КОМПАНИИ КЛЮЧА. Обёртка
// отдаёт снимок и отпускает фоновое перечитывание: страницы клиентов, потом
// отдельный запрос `updated_at`. Глобальный клиент берёт заголовок на каждый
// запрос, и переход посреди этой цепочки отправлял бы её хвост под другой
// компанией: ноль строк, `cacheReplaceTenant` стирает клиентов этой компании,
// а уцелевшие ложатся без штампа LWW. Мастерские RPC идут прежним клиентом:
// SQLite они не пишут.
//
// ЦЕНА, ПРИНЯТАЯ НАМЕРЕННО. Привязанный клиент объявляет себя полем
// `BOUND_TENANT_FIELD`, и выгрузка очереди через него не работает вовсе. Когда
// перечитывание пропущено из-за ждущих операций, его `kickReplayer` теперь
// ничего не делает; очередь всё равно разгребают старт синхронизации, возврат
// сети и мутации — они зовут выгрузку глобальным клиентом. Снимать поле
// нельзя: непомеченный привязанный клиент выгрузил бы удаление активной
// компании под заголовком другой.

// ЗЕРКАЛО ДОВОДИТ СТРОКУ ДО ТОЙ, ЧТО ПОЛУЧИЛ БЫ СОТРУДНИК (STORY-083; с
// 30.09 — по блокам карточки, `mirrorMemberClient`, 015).
//
// В предпросмотре строки приходят с сервера по токену ВЛАДЕЛЬЦА, а он видит
// всё: сервер не знает, что владелец «смотрит чужими глазами». Раньше здесь
// гасились только контакты; теперь — ещё и поля закрытых блоков, а `blocks` и
// причина скрытого номера ставятся по карте зеркала, чтобы гейты карточки
// (`card-access.ts`) показали ровно то, что увидит сотрудник. Только для
// показа: запись из зеркала невозможна — это чужие глаза, а не чужие руки.

export function useClients() {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  // В ЗЕРКАЛЕ («Посмотреть его глазами») строки пришли по токену ВЛАДЕЛЬЦА
  // целиком. Экран доводит их до того, что отдал бы сервер сотруднику:
  // контакты пустые всегда, поля закрытых блоков пустые, `blocks` и причина
  // скрытого номера — по карте зеркала (015, 30.09). Иначе владелец видел бы
  // заметки, объекты и долг, которых сотрудник не получит.
  const mirrorMap = useMirroredMemberMap(scope.kind);
  // И только ЕГО клиенты: по токену владельца сервер отдаёт всю базу, а
  // сотрудник получает набор «Какие клиенты» (проверка глазами 30.09 —
  // десять строк вместо двух). Пока набор едет — пусто, а не вся база.
  const mirrorScope = useMirrorClientScope(mirrorMap);
  const mirrorRows = useCallback(
    (rows: Client[]) =>
      mirrorMap
        ? rows
            .filter((row) => mirrorScope !== undefined && inMirrorView(row, mirrorScope))
            .map((row) => mirrorMemberClient(row, mirrorMap, mirrorScope))
        : rows,
    [mirrorMap, mirrorScope],
  );
  return useQuery({
    // У своей компании и у клиента записи ключ ТОТ ЖЕ, что был, — его греет
    // прогрев компании (`tenant-prefetch-plan`). У работодателя третий
    // элемент несёт уровни: сменили уровень — сменился ключ.
    queryKey:
      scope.kind === "member"
        ? sourceClientsQueryKey(tenantId, scope.view)
        : clientsQueryKey(tenantId, scope.role),
    enabled: !!tenantId && scope.ready,
    queryFn: () => {
      if (scope.kind === "record") return listMasterClientsSafe(supabase);
      if (scope.kind === "member") {
        const bound = tenantBoundClient(tenantId as string);
        if (!scope.withRecordClients) return listMemberClients(bound);
        return withRecordClients(listMemberClients(bound), listMasterClientsSafe(supabase));
      }
      return listClientsCached(tenantBoundClient(tenantId as string), tenantId as string);
    },
    select: mirrorMap ? mirrorRows : undefined,
  });
}
