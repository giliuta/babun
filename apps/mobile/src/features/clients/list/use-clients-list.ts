import { useLocalSearchParams, useRouter } from "expo-router";
import { useToast } from "@/components/ui/Toast";
import { loadErrorWords } from "@/lib/connection-words";
import { useThemeColors } from "@/theme/colors";
import { useListBulk } from "./use-list-bulk";
import { useListFilters } from "./use-list-filters";
import { useListMerge } from "./use-list-merge";
import { useListRowActions } from "./use-list-row-actions";
import { useListSources } from "./use-list-sources";
import { useListTeamScope } from "./use-list-team-scope";
import { useListUiState } from "./use-list-ui-state";

/** All wiring of the clients list. Sub-hooks run in the order the screen
 *  always called them. */
export function useClientsList() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  // Экран настроек возвращается сюда с nonce-параметром:
  // «Импорт из CSV» → openImport.
  const params = useLocalSearchParams<{
    openImport?: string;
    /** «Из контактов телефона» → openContacts. */
    openContacts?: string;
  }>();
  const sources = useListSources();
  const ui = useListUiState(params);
  const merged = useListMerge({
    scope: sources.scope,
    data: sources.data,
    guests: sources.guests,
    ownAppointments: sources.ownAppointments,
    ownTeams: sources.ownTeams,
    ownTags: sources.ownTags,
  });
  const team = useListTeamScope({
    scope: sources.scope,
    caps: sources.caps,
    guests: sources.guests,
    ownTeams: sources.ownTeams,
    teams: merged.teams,
    clients: merged.clients,
    appointments: merged.appointments,
  });
  const filters = useListFilters({
    tags: merged.tags,
    teams: merged.teams,
    teamChoice: team.teamChoice,
    teamClients: team.teamClients,
    teamAppointments: team.teamAppointments,
    cities: sources.cities,
    statsMap: team.statsMap,
    sort: sources.sort,
    filter: ui.filter,
    setFilter: ui.setFilter,
    query: ui.query,
    sheetOpen: ui.sheetOpen,
    tagsReady: sources.tagsReady,
    citiesReady: sources.citiesReady,
    data: sources.data,
  });
  const rows = useListRowActions({
    scope: sources.scope,
    caps: sources.caps,
    guestOf: merged.guestOf,
    teamChoice: team.teamChoice,
    allStatsMap: team.allStatsMap,
    deleteWithUndo: sources.deleteWithUndo,
    updateById: sources.updateById,
  });
  const bulk = useListBulk({
    result: filters.result,
    guestOf: merged.guestOf,
    selectedIds: ui.selectedIds,
    setSelectedIds: ui.setSelectedIds,
    setSelecting: ui.setSelecting,
    tags: merged.tags,
    allStatsMap: team.allStatsMap,
    toast,
    deleteWithUndo: sources.deleteWithUndo,
  });

  // Обрыв — словами, а не текстом ошибки (03.10).
  const listErrorWords = loadErrorWords(sources.error, {
    failed: "Не удалось загрузить клиентов",
    later: "Клиенты загрузятся, как только сервер ответит.",
  });

  return {
    t,
    router,
    ...sources,
    ...ui,
    ...merged,
    ...team,
    ...filters,
    ...rows,
    ...bulk,
    listErrorWords,
  };
}

export type ClientsList = ReturnType<typeof useClientsList>;
