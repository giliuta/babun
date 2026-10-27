import { useDeferredValue, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { useClientSources } from "@/features/clients/acquisition-sources";
import { sourceFilterOptions, type ClientSource } from "@/features/clients/acquisition-source";
import type { ClientsFilter } from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useFeatureOn } from "@/features/settings/company-features";
import type { ListTeam } from "./use-list-merge";
import { filterTagsFor, pruneFilter } from "./list-derive";

const NO_SOURCES: ClientSource[] = [];

type FilterArgs = Parameters<typeof useClientFilters>;

/** Search and filters over the team's rows, plus pruning of values that
 *  vanished from the references. */
export function useListFilters({
  tags,
  teams,
  teamChoice,
  teamClients,
  teamAppointments,
  cities,
  statsMap,
  sort,
  filter,
  setFilter,
  query,
  sheetOpen,
  tagsReady,
  citiesReady,
  data,
}: {
  tags: ClientTag[];
  teams: ListTeam[];
  teamChoice: string;
  teamClients: FilterArgs[0];
  teamAppointments: FilterArgs[1];
  cities: FilterArgs[3];
  statsMap: FilterArgs[5];
  sort: FilterArgs[6];
  filter: ClientsFilter;
  setFilter: Dispatch<SetStateAction<ClientsFilter>>;
  query: string;
  sheetOpen: boolean;
  tagsReady: boolean;
  citiesReady: boolean;
  data: Client[] | undefined;
}) {
  // ТЕГИ В ФИЛЬТРАХ — КОМАНДЫ: правило — `filterTagsFor`.
  const filterTags = useMemo(
    () => filterTagsFor(tags, teams, teamChoice === ALL_TEAMS ? null : teamChoice),
    [tags, teams, teamChoice],
  );
  // ИСТОЧНИКИ КОМАНД — все: значение клиента любой команды читается
  // по ним; варианты фильтра — по именам, под чипом — только его команды.
  const sourcesQuery = useClientSources();
  const ownSources = sourcesQuery.data ?? NO_SOURCES;

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  // Поиск фильтрует отложенно: буква сразу видна в
  // поле, а пересчёт сотен клиентов и перерисовка строк идут следом и не
  // держат клавиатуру.
  const searched = useDeferredValue(query);
  const result = useClientFilters(
    teamClients,
    teamAppointments,
    teams,
    cities,
    filterTags,
    statsMap,
    sort,
    filter,
    searched,
    sheetOpen, // счётчики попапов считаем только при открытом листе
    ownSources,
    teamChoice === ALL_TEAMS ? null : teamChoice,
  );

  // Прунинг «призрачных» фильтров — `pruneFilter`. Теги и источники
  // сверяются со ВСЕМ справочником, а не с вариантами под чипом: тап по
  // чипу сужает варианты до его команды, и прунинг по ним навсегда
  // выкидывал из «набора дня» выбранное в другой команде. Убирается только
  // то, чего больше нет нигде.
  const { teamOptions, cityOptions } = result;
  const tagOptions = useMemo(() => tags.map((tag) => ({ value: tag.id })), [tags]);
  const sourceOptions = useMemo(() => sourceFilterOptions(ownSources, null), [ownSources]);
  const sourcesReady = sourcesQuery.isSuccess;
  useEffect(() => {
    setFilter((f) =>
      pruneFilter(f, {
        teamOptions,
        tagOptions,
        cityOptions,
        sourceOptions,
        sourcesReady,
        tagsReady,
        citiesLoaded: citiesReady && data !== undefined,
      }),
    );
    // `setFilter` is the list's state setter: stable, listed only for the linter.
  }, [teamOptions, cityOptions, tagOptions, sourceOptions, sourcesReady, tagsReady, citiesReady, data, setFilter]);

  // ОБЪЕКТЫ ВЫКЛЮЧЕНЫ — «ТИП ОБЪЕКТА» НЕ ФИЛЬТРУЕТ. Строки в «Фильтрах» тогда
  // нет, а сохранённый в наборе дня «Дом» продолжал прятать клиентов, и снять
  // его можно было только общим «Сбросить».
  const objectsOn = useFeatureOn("objects");
  useEffect(() => {
    if (objectsOn) return;
    setFilter((f) => (f.propertyTypes.length === 0 ? f : { ...f, propertyTypes: [] }));
  }, [objectsOn, setFilter]);

  const filtering = result.activeCount > 0 || query.trim().length > 0;

  return { result, filtering };
}
