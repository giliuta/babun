import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listClientTags as repoListClientTags } from "@babun/shared/db/repositories/clients";
import {
  createClientTag as createClientTagCached,
  deleteClientTag as deleteClientTagCached,
  listClientTags as listClientTagsCached,
  updateClientTag as updateClientTagCached,
} from "@babun/shared/sync/tagsCached";
import type { ClientTag } from "@babun/shared/local/clients";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { clientTagsQueryKey, sourceClientTagsQueryKey } from "@/lib/company-query-keys";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { clientKeys } from "../query-keys";
import { assertOwnCompany, useQueryScope, writeClientOf, type QueryScope } from "./scope";

export function useClientTags() {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  return useQuery({
    queryKey:
      scope.kind === "member"
        ? sourceClientTagsQueryKey(tenantId, scope.view)
        : clientTagsQueryKey(tenantId, scope.role),
    enabled: !!tenantId && scope.ready,
    // SWR wrapper read (same as useClients): warm cache serves instantly, the
    // background revalidate prunes + emits, the realtime bridge re-reads.
    // Привязанным клиентом — разбор над `useClients`.
    queryFn: () => {
      // Клиент записи метками компании не распоряжается и не видит их.
      if (scope.kind === "record") return Promise.resolve([]);
      // Метки работодателя нужны, чтобы его клиенты в списке были подписаны,
      // но на диск чужой справочник не ложится — читаем напрямую.
      if (scope.kind === "member") {
        return repoListClientTags(tenantBoundClient(tenantId as string), tenantId as string);
      }
      return listClientTagsCached(tenantBoundClient(tenantId as string), tenantId as string);
    },
  });
}

export interface CreateClientTagInput {
  name: string;
  color: string;
  icon?: string | null;
  /** Команда тега — у каждой команды свои теги (владелец 30.09). */
  teamId: string;
}

export interface UpdateClientTagInput {
  id: string;
  patch: {
    name?: string;
    color?: string;
    icon?: string | null;
    position?: number;
    hidden?: boolean;
  };
}

/** Справочник тегов — хозяйство своей компании: у работодателя человек метки
 *  видит (они стоят на его клиентах), но не правит. */
function assertCanManageClientTags(
  scope: QueryScope,
): asserts scope is QueryScope & { tenantId: string } {
  // ПАРТНЁР ПРАВИТ ТЕГИ КОМАНДЫ ПО ПРАВУ «ТЕГИ КЛИЕНТОВ» (владелец 01.10).
  // Какой команды — решает сервер политикой `client_tags_write_settings`;
  // здесь только не мешаем ему ответить.
  if (scope.kind === "member") {
    if (!scope.tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
    return;
  }
  assertOwnCompany(scope, "Управлять тегами");
  if (scope.role !== "owner" && scope.role !== "dispatcher") {
    throw new Error("Управлять тегами может владелец или диспетчер.");
  }
}

function invalidateClientTags(qc: ReturnType<typeof useQueryClient>) {
  // A deleted tag is removed from client_tag_assignments on the server. The
  // client list/cache also needs a refresh so no stale tag id survives in an
  // already-open card or CSV export.
  void qc.invalidateQueries({ queryKey: clientKeys.tagAll() });
  void qc.invalidateQueries({ queryKey: clientKeys.all() });
  void qc.invalidateQueries({ queryKey: clientKeys.cardAll() });
}

export function useCreateClientTag() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, CreateClientTagInput>({
    ...NEVER_PAUSE,
    mutationFn: ({ name, color, icon, teamId }) => {
      assertCanManageClientTags(scope);
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Введите название тега.");
      return createClientTagCached(
        writeClientOf(scope),
        { name: normalizedName, color, icon: icon ?? null, team_id: teamId },
        scope.tenantId,
        scope.writeOpts,
      );
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useUpdateClientTag() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, UpdateClientTagInput>({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }) => {
      assertCanManageClientTags(scope);
      const normalizedPatch = {
        ...patch,
        ...(patch.name != null ? { name: patch.name.trim() } : null),
      };
      if (normalizedPatch.name === "") {
        throw new Error("Введите название тега.");
      }
      return updateClientTagCached(writeClientOf(scope), id, normalizedPatch, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

/** СКРЫТЬ И ПОКАЗАТЬ — левая кромка свайпа, как у категории и метки (владелец
 *  2026-09-10: «свайп вправо — с левой стороны появляется „Скрыть“… везде во
 *  всех одно и то же»). Скрытый тег остаётся у клиентов, которым уже
 *  проставлен: скрытие — про справочник, а не про данные. */
export function useSetClientTagHidden() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<ClientTag, Error, { id: string; hidden: boolean }>({
    ...NEVER_PAUSE,
    mutationFn: ({ id, hidden }) => {
      assertCanManageClientTags(scope);
      return updateClientTagCached(writeClientOf(scope), id, { hidden }, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

/** ПОРЯДОК СПРАВОЧНИКА — рукой за ручку. Пишем построчно: тегов у бизнеса
 *  единицы, а один upsert потребовал бы отправлять имя и цвет каждой строки,
 *  то есть шанс затереть чужую правку, пришедшую между чтением и записью. */
export function useReorderClientTags() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<void, Error, string[]>({
    ...NEVER_PAUSE,
    mutationFn: async (orderedIds) => {
      assertCanManageClientTags(scope);
      for (const [position, id] of orderedIds.entries()) {
        await updateClientTagCached(writeClientOf(scope), id, { position }, scope.tenantId, scope.writeOpts);
      }
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}

export function useDeleteClientTag() {
  const scope = useQueryScope();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    ...NEVER_PAUSE,
    mutationFn: (id) => {
      assertCanManageClientTags(scope);
      return deleteClientTagCached(writeClientOf(scope), id, scope.tenantId, scope.writeOpts);
    },
    onSettled: () => invalidateClientTags(qc),
    meta: { errorHandled: true },
  });
}
