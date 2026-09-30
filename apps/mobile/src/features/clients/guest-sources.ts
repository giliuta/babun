import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Team } from "@babun/shared/local/masters";
import { listClientTags as repoListClientTags } from "@babun/shared/db/repositories/clients";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import {
  appointmentsQueryKey,
  sourceClientTagsQueryKey,
  sourceClientsQueryKey,
  teamsQueryKey,
} from "@/lib/company-query-keys";
import { fetchTeams } from "@/features/reference/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
import { listMemberClients } from "./queries";
import { viewKeyOf, type ClientsScope } from "./clients-company";

// КЛИЕНТЫ КОМПАНИЙ, ГДЕ ЧЕЛОВЕК РАБОТАЕТ, — ВТОРАЯ ПОЛОВИНА ОБЩЕГО СПИСКА.
//
// Своя компания читается обычными хуками вкладки (у них источник из
// контекста). Остальные источники приходят сюда: их может быть сколько угодно,
// и хук на каждый не заведёшь — поэтому `useQueries`.
//
// Что берём у гостевой компании и зачем:
//   • клиентов — окном сервера (`list_member_clients`): ровно его набор, без
//     денег компании и, если телефоны закрыты, без контактов;
//   • метки — чтобы его клиенты в списке были подписаны как везде;
//   • команды и его записи — чтобы работали «последний визит» и фильтр
//     «Команда»: владелец различает своих и чужих клиентов именно им, пока
//     разделителей нет.
// Всё это живёт в памяти: чужая база на диск не ложится и в очередь не встаёт.

export interface GuestSource {
  scope: ClientsScope;
  clients: Client[];
  appointments: Appointment[];
  teams: Team[];
  tags: ClientTag[];
}

export interface GuestSources {
  list: GuestSource[];
  loading: boolean;
  /** Перечитать всё гостевое — вместе с жестом обновления списка. */
  refetch: () => Promise<unknown>;
}

const MINUTE = 60_000;

export function useGuestSources(scopes: readonly ClientsScope[]): GuestSources {
  const queries = useQueries({
    queries: scopes.flatMap((scope) => {
      const tenantId = scope.tenantId;
      const view = viewKeyOf(scope);
      // У чужой компании нет ни realtime, ни моста кэша: обновляем на входе
      // на экран и жестом, а не «когда-нибудь».
      const common = { staleTime: MINUTE, refetchOnMount: true as const };
      return [
        {
          ...common,
          queryKey: sourceClientsQueryKey(tenantId, view),
          queryFn: () => listMemberClients(tenantBoundClient(tenantId)),
        },
        {
          ...common,
          queryKey: sourceClientTagsQueryKey(tenantId, view),
          queryFn: () => repoListClientTags(tenantBoundClient(tenantId), tenantId),
        },
        {
          ...common,
          queryKey: teamsQueryKey(tenantId, scope.role, true),
          queryFn: () => fetchTeams(tenantBoundClient(tenantId), tenantId, scope.role, true),
        },
        {
          ...common,
          queryKey: appointmentsQueryKey(tenantId, scope.role),
          queryFn: () => listMasterAppointmentsSafePaged(tenantBoundClient(tenantId)),
        },
      ];
    }),
  });

  const stamps = queries.map((query) => `${query.dataUpdatedAt}:${query.isFetching}`).join(",");
  const ids = scopes.map((scope) => `${scope.tenantId}:${viewKeyOf(scope)}`).join(",");

  return useMemo(() => {
    const list: GuestSource[] = scopes.map((scope, index) => {
      const at = index * 4;
      return {
        scope,
        clients: (queries[at]?.data as Client[] | undefined) ?? [],
        tags: (queries[at + 1]?.data as ClientTag[] | undefined) ?? [],
        teams: (queries[at + 2]?.data as Team[] | undefined) ?? [],
        appointments: (queries[at + 3]?.data as Appointment[] | undefined) ?? [],
      };
    });
    return {
      list,
      // Ждём только СПИСКИ клиентов: подписи и записи догружаются следом и
      // пустой строкой список не держат.
      loading: scopes.some((_, index) => queries[index * 4]?.isPending === true),
      refetch: () => Promise.all(queries.map((query) => query.refetch())),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересборка по времени ответов, а не по массиву результатов
  }, [ids, stamps]);
}
