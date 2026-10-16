import { useCallback, useMemo } from "react";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useClients, useClientTags, useUpdateClientById } from "@/features/clients/queries";
import { useDeleteWithUndo } from "@/features/clients/delete-undo";
import { DEFAULT_SORT } from "@/features/clients/filter";
import { useClientsCapabilities, useClientsScopeOrNull } from "@/session/company-scope";
import { useClientsSources } from "@/features/clients/sources";
import { useGuestSources } from "@/features/clients/guest-sources";
import { useClientsSort, useSetClientsSort } from "@/features/clients/sort-pref";
import { useAppointments } from "@/features/calendar/queries";
import { useCities, useTeams } from "@/features/reference/queries";

/** Where the list reads from: its own company plus the companies that opened
 *  their clients to this person («гости»), and the writers rows use. */
export function useListSources() {
  const scope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();
  const sources = useClientsSources();
  // Гости — компании, где человеку открыли клиентов; своя читается обычными
  // хуками вкладки (у них источник из контекста).
  const guestScopes = useMemo(
    () => sources.list.filter((source) => source.tenantId !== scope?.tenantId),
    [sources.list, scope?.tenantId],
  );
  const guests = useGuestSources(guestScopes);
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  // Контрол обновления отражает ЖЕСТ, а не любое дообновление: иначе список
  // сам уезжал вниз с застывшей системной вертушкой.
  const refreshAll = useCallback(
    () => Promise.all([refetch(), guests.refetch()]),
    [refetch, guests],
  );
  const pull = usePullRefresh(refreshAll);
  const { data: ownTags = [], isSuccess: tagsReady } = useClientTags();
  const { data: ownAppointments = [] } = useAppointments();
  const { data: ownTeams = [] } = useTeams();
  const { data: cities = [], isSuccess: citiesReady } = useCities();
  // Сортировка — персистентная настройка списка (первая строка листа
  // «Фильтры»), не фильтр: «Сбросить» её не трогает.
  const { data: sort = DEFAULT_SORT } = useClientsSort();
  const setSort = useSetClientsSort();
  const deleteWithUndo = useDeleteWithUndo();
  const updateById = useUpdateClientById();
  return {
    scope,
    caps,
    guests,
    data,
    isLoading,
    isRefetching,
    refetch,
    error,
    pull,
    ownTags,
    tagsReady,
    ownAppointments,
    ownTeams,
    cities,
    citiesReady,
    sort,
    setSort,
    deleteWithUndo,
    updateById,
  };
}
