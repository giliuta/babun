import { useDeferredValue, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { useClientSources } from "@/features/clients/acquisition-sources";
import { sourceFilterOptions, type ClientSource } from "@/features/clients/acquisition-source";
import type { ClientsFilter } from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useFeatureOn } from "@/features/settings/company-features";
import { useBusinessToday } from "@/features/settings/business-today";
import type { ListTeam } from "./use-list-merge";
import { cityFacetOptions } from "@/features/clients/useClientFilters/options";
import { filterLabelsFor, filterTagsFor, pruneFilter, uniqueById } from "./list-derive";

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
  guestClientSources,
  guestSourcesSettled,
}: {
  tags: ClientTag[];
  teams: ListTeam[];
  teamChoice: string;
  teamClients: FilterArgs[0];
  teamAppointments: FilterArgs[1];
  /** Справочник меток компании: отбор по календарям ленты — здесь. */
  cities: (FilterArgs[3][number] & { team_id: string | null; is_active?: boolean | null; deleted_at?: string | null })[];
  statsMap: FilterArgs[5];
  sort: FilterArgs[6];
  filter: ClientsFilter;
  setFilter: Dispatch<SetStateAction<ClientsFilter>>;
  query: string;
  sheetOpen: boolean;
  tagsReady: boolean;
  citiesReady: boolean;
  data: Client[] | undefined;
  /** Источники гостевых компаний (`useListMerge`). */
  guestClientSources: ClientSource[];
  guestSourcesSettled: boolean;
}) {
  // МЕТКИ В ФИЛЬТРАХ — КАЛЕНДАРЕЙ ЛЕНТЫ: правило — `filterLabelsFor`.
  // Прунинг сверяется с метками ВСЕХ календарей ленты: тап по чипу сужает
  // варианты, но не выкидывает выбранное в другой команде.
  const ribbonLabels = useMemo(() => filterLabelsFor(cities, teams, null), [cities, teams]);
  const filterLabels = useMemo(
    () => (teamChoice === ALL_TEAMS ? ribbonLabels : filterLabelsFor(cities, teams, teamChoice)),
    [cities, teams, teamChoice, ribbonLabels],
  );
  // ТЕГИ В ФИЛЬТРАХ — КОМАНДЫ: правило — `filterTagsFor`.
  const filterTags = useMemo(
    () => filterTagsFor(tags, teams, teamChoice === ALL_TEAMS ? null : teamChoice),
    [tags, teams, teamChoice],
  );
  // ИСТОЧНИКИ КОМАНД — все: значение клиента любой команды читается
  // по ним; варианты фильтра — по именам, под чипом — только его команды.
  // У партнёра в списке и клиенты компании-работодателя: их источники
  // приходят гостевым чтением и склеиваются со своими по id.
  const sourcesQuery = useClientSources();
  const ownData = sourcesQuery.data ?? NO_SOURCES;
  const ownSources = useMemo(
    () =>
      guestClientSources.length === 0 ? ownData : uniqueById([...ownData, ...guestClientSources]),
    [ownData, guestClientSources],
  );

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  // Поиск фильтрует отложенно: буква сразу видна в
  // поле, а пересчёт сотен клиентов и перерисовка строк идут следом и не
  // держат клавиатуру.
  const searched = useDeferredValue(query);
  const today = useBusinessToday();
  const result = useClientFilters(
    teamClients,
    teamAppointments,
    teams,
    filterLabels,
    filterTags,
    statsMap,
    sort,
    filter,
    searched,
    sheetOpen, // счётчики попапов считаем только при открытом листе
    ownSources,
    teamChoice === ALL_TEAMS ? null : teamChoice,
    today,
  );

  // Прунинг «призрачных» фильтров — `pruneFilter`. Теги и источники
  // сверяются со ВСЕМ справочником, а не с вариантами под чипом: тап по
  // чипу сужает варианты до его команды, и прунинг по ним навсегда
  // выкидывал из «набора дня» выбранное в другой команде. Убирается только
  // то, чего больше нет нигде.
  const { teamOptions } = result;
  const cityOptions = useMemo(() => cityFacetOptions(data ?? [], ribbonLabels), [data, ribbonLabels]);
  const tagOptions = useMemo(() => tags.map((tag) => ({ value: tag.id })), [tags]);
  const sourceOptions = useMemo(() => sourceFilterOptions(ownSources, null), [ownSources]);
  const sourcesReady = sourcesQuery.isSuccess && guestSourcesSettled;
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
