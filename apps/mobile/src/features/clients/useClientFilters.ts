import { useMemo } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { matchesClient, rankClientMatches } from "@babun/shared/local/selectors/client-search";
import { clientMemberOf, clientsById } from "@babun/shared/local/selectors/client-links";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  clientPropertyTypes,
  matchesSegment,
  sortClients,
  type ActiveToken,
  type ClientsFilter,
  type FacetOption,
  type SortKey,
  todayYMD,
} from "./filter";
import {
  sourceBucket,
  sourceFilterOptions,
  type ClientSource,
} from "./acquisition-source";
import {
  buildClientAppointmentIndex,
  type ClientAppointmentIndex,
} from "./useClientFilters/appointment-index";
import { countFacets, type FacetCounts } from "./useClientFilters/facet-counts";
import {
  cityFacetOptions,
  propertyFacetOptions,
  propertyKey,
  type CityLike,
  type TeamLike,
} from "./useClientFilters/options";
import { activeFilterTokens } from "./useClientFilters/tokens";

export { buildClientAppointmentIndex };
export type { ClientAppointmentIndex, FacetCounts };

const NO_SOURCES: ClientSource[] = [];

// Волна 2 — порт web useClientFilters (v812): один хук владеет
// отфильтрованным списком, опциями фасетов и токенами бара.
// Отличие от веба — структура мемо: сортировка живёт в СВОЁМ
// useMemo (deps: clients/sort/statsMap), а предикаты применяются к уже
// отсортированному списку. Фильтр сохраняет порядок → результат
// идентичен вебу, но клавиатурный ввод в поиске НЕ перегоняет
// O(n log n) localeCompare-компаратор (фикс Волны 1 — не откатывать).
//
// Pure parts live in `./useClientFilters/`: the appointment index, facet
// option builders, facet counters and summary-bar tokens.

export interface ClientFilterResult {
  /** Итоговый отсортированный+отфильтрованный список. */
  filtered: Client[];
  /** Удаляемые токены summary-бара (сегмент/команды/метки/теги/период). */
  activeTokens: ActiveToken[];
  /** Число активных значений ФИЛЬТРА (не сортировки) — бейдж бара. */
  activeCount: number;
  teamOptions: FacetOption[];
  cityOptions: FacetOption[];
  tagOptions: FacetOption[];
  /** Типы объектов, которые РЕАЛЬНО есть в данных (порядок по частоте). */
  propertyOptions: FacetOption[];
  /** Источники: готовые, свои команд, «Неизвестно». */
  sourceOptions: FacetOption[];
  facetCounts: FacetCounts;
  /** Строки Источник/Тип объекта появляются, когда данные есть хоть у
   *  одного клиента — пустой справочник не даёт мёртвую строку. */
  hasSourceData: boolean;
  hasPropertyData: boolean;
}

export function useClientFilters(
  clients: Client[],
  appointments: Appointment[],
  teams: TeamLike[],
  cities: CityLike[],
  tags: ClientTag[],
  statsMap: Map<string, ClientStats>,
  /** Сортировка — настройка списка (sort-pref), не часть фильтра. */
  sort: SortKey,
  filter: ClientsFilter,
  search: string,
  /** Считать контекстные счётчики попапов только когда лист открыт —
   *  иначе полный проход по клиентам гоняется на каждую клавишу поиска. */
  withFacetCounts: boolean,
  /** Источники команд (`client_sources`) — все: по ним читается значение
   *  клиента любой команды. */
  customSources: ClientSource[] = NO_SOURCES,
  /** Команда чипа: варианты фасета — только её источники. */
  sourceTeamId: string | null = null,
  /** «Сегодня» компании (`useBusinessToday` у вызывающего; модуль без
   *  React Native — его читают тесты). Без него — часы телефона. */
  today: string = todayYMD(),
): ClientFilterResult {
  const {
    segments,
    selectedTeams,
    selectedCities,
    activeTags,
    period,
    sources,
    propertyTypes,
  } = filter;

  const index = useMemo(
    () => buildClientAppointmentIndex(clients, appointments),
    [clients, appointments],
  );

  // ── Опции фасетов ────────────────────────────────────────────────
  // Вся библиотека сразу: фасеты
  // показывают полный справочник, а не только использованные значения —
  // фильтр по пустому значению честно даёт 0 в футере.
  const teamOptions = useMemo<FacetOption[]>(() => {
    return teams.map((t) => ({
      value: t.id,
      label: t.name,
      // Supabase-row может держать color=null — точка не должна пропасть.
      color: t.color ?? getAvatarColor(t.name),
    }));
  }, [teams]);

  const cityOptions = useMemo<FacetOption[]>(
    () => cityFacetOptions(clients, cities),
    [clients, cities],
  );

  const propertyOptions = useMemo<FacetOption[]>(
    () => propertyFacetOptions(clients),
    [clients],
  );
  const propertyValueByKey = useMemo(
    () => new Map(propertyOptions.map((o) => [propertyKey(o.value), o.value])),
    [propertyOptions],
  );

  const tagOptions = useMemo<FacetOption[]>(() => {
    // Весь справочник тегов, не только назначенные.
    // Тег без цвета терял тик сущности — падаем на avatar-цвет, как метки.
    return tags.map((t) => ({
      value: t.id,
      label: t.name,
      color: t.color || getAvatarColor(t.name),
    }));
  }, [tags]);

  // ── Предикаты (замыкания на текущем состоянии) ───────────────────
  // Карта карточек — один раз на набор, а не на каждую строку каждой клавиши.
  const groupsById = useMemo(() => clientsById(clients), [clients]);
  const passesSearch = useMemo(() => {
    const q = search.trim();
    // Жильцов управляющей находят по её имени: к полям клиента добавляются
    // имя каждой карточки, в которую он входит, его роль и место.
    // …и имя его тега: «VIP» в поиске не находил
    // никого, хотя тег стоит плиткой на карточке и чипом в фильтре.
    const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
    const linkWords = (c: Client): string[] => [
      ...clientMemberOf(c, groupsById).flatMap((e) => [
        e.group?.full_name ?? "",
        e.role,
        e.location?.label ?? "",
      ]),
      ...(c.tag_ids ?? []).map((id) => tagName.get(id) ?? ""),
    ];
    return (c: Client) => (q ? matchesClient(c, search, linkWords(c)) : true);
  }, [search, groupsById, tags]);

  // Одна дата на весь проход фильтра — «сегодня» КОМПАНИИ, как у статистики
  // (`buildStatsMap`) и календаря: по часам телефона владелец в другом поясе
  // после своей полуночи видел «Должников» и «Записан» по завтрашнему дню.
  const todayForSegments = today;
  const passesSegment = useMemo(() => {
    // OR по выбранным статусам («список на обзвон»: любой из выбранных) —
    // единая семантика с Метка/Теги/Команда. AND давал ловушку: второй
    // статус сужал в ноль, а счётчиков, объяснявших это, на контролах
    // нет.
    return (c: Client): boolean => {
      if (segments.length === 0) return true;
      const s = statsMap.get(c.id);
      // `today` передаётся ЯВНО: без него `matchesSegment` звал `new Date()`
      // на каждого клиента × каждый статус, и на границе суток счётчик в
      // попапе (он дату передаёт) расходился со списком.
      return segments.some((seg) => matchesSegment(c, seg, s, todayForSegments));
    };
  }, [segments, statsMap, todayForSegments]);

  const passesPeriod = useMemo(() => {
    return (c: Client): boolean => {
      if (!period) return true;
      const dates = index.clientApptDates.get(c.id) ?? [];
      // ЛЮБАЯ запись внутри [from, to] включительно.
      return dates.some((d) => d >= period.from && d <= period.to);
    };
  }, [period, index]);

  const passesTeam = useMemo(() => {
    const sel = selectedTeams;
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      const set = index.clientTeams.get(c.id);
      if (!set || set.size === 0) return false;
      return sel.some((id) => set.has(id));
    };
  }, [selectedTeams, index]);

  const passesCity = useMemo(() => {
    // Case-insensitive: опция несёт каноничное написание библиотеки, а
    // web/legacy-значение клиента может отличаться регистром.
    // Метка — тоже в пределах вариантов чипа (см. `liveTags` ниже).
    const offered = new Set(cityOptions.map((o) => o.value.trim().toLowerCase()));
    const sel = selectedCities
      .map((s) => s.trim().toLowerCase())
      .filter((s) => offered.has(s));
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      return sel.includes((c.city ?? "").trim().toLowerCase());
    };
  }, [selectedCities, cityOptions]);

  // ВЫБРАННОЕ ДЕЙСТВУЕТ ТОЛЬКО В ПРЕДЕЛАХ ВАРИАНТОВ ЧИПА. Тег или источник,
  // выбранный под командой A, под чипом B не имеет ни токена, ни строки в
  // фильтре, и фильтровать им невидимо значило врать «В этой команде пока нет
  // клиентов». Сам выбор не стирается: вернулись на A — он снова в силе.
  const liveTags = useMemo(() => {
    const offered = new Set(tagOptions.map((o) => o.value));
    return activeTags.filter((id) => offered.has(id));
  }, [activeTags, tagOptions]);
  const passesTag = useMemo(() => {
    const sel = liveTags;
    // OR-внутри фасета — единая семантика с Команда/Метка: показать
    // клиентов с ЛЮБЫМ из выбранных тегов (между секциями остаётся AND).
    return (c: Client): boolean =>
      sel.length === 0 || sel.some((t) => c.tag_ids.includes(t));
  }, [liveTags]);

  const sourceOptions = useMemo<FacetOption[]>(
    () => sourceFilterOptions(customSources, sourceTeamId),
    [customSources, sourceTeamId],
  );

  // Корзина — имя строки источника: «Instagram» всех команд — один вариант.
  const passesSource = useMemo(() => {
    const offered = new Set(sourceOptions.map((o) => o.value));
    const sel = (sources as string[]).filter((value) => offered.has(value));
    return (c: Client): boolean =>
      sel.length === 0 || sel.includes(sourceBucket(c.acquisition_source, customSources, c.team_id));
  }, [sources, customSources, sourceOptions]);

  // Тип объекта сравнивается без регистра — как и схлопывается в варианты
  // «Дом» у одного клиента и «дом» у другого — один
  // вариант, и выбор «Дом» обязан находить обоих, а не только первого.
  const passesProperty = useMemo(() => {
    const sel = (propertyTypes as string[]).map(propertyKey);
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      const own = new Set([...clientPropertyTypes(c)].map(propertyKey));
      return sel.some((p) => own.has(p));
    };
  }, [propertyTypes]);

  // Строки-фильтры «портрета» появляются, только когда данные есть.
  const hasSourceData = useMemo(
    () => clients.some((c) => sourceBucket(c.acquisition_source, customSources, c.team_id) !== "unknown"),
    [clients, customSources],
  );
  const hasPropertyData = useMemo(
    () => clients.some((c) => clientPropertyTypes(c).size > 0),
    [clients],
  );

  // ── Сортировка ОТДЕЛЬНО от предикатов ────────────────────────────
  // Мемо без поисковых deps — фильтрация ниже сохраняет порядок (фикс
  // Волны 1, не откатывать). Ключи сортировки предвычисляются ОДНИМ
  // проходом, дальше сравниваются числа/строки — statsMap не дёргается
  // на каждое сравнение. Правило хвоста: у кого НЕТ значения по активной
  // оси (ни одного визита / нет долга / нет дохода) — вниз при любом
  // направлении; фолбэка «lastVisitDate || created_at» больше нет (он
  // ставил клиента «нет записей» выше обслуженного сегодня, потому что
  // ISO-время created_at длиннее и «больше» голой даты).
  const sorted = useMemo(
    () => sortClients(clients, statsMap, sort),
    [clients, sort, statsMap],
  );

  const filtered = useMemo(() => {
    const hits = sorted.filter(
      (c) =>
        passesSearch(c) &&
        passesTag(c) &&
        passesSegment(c) &&
        passesTeam(c) &&
        passesCity(c) &&
        passesPeriod(c) &&
        passesSource(c) &&
        passesProperty(c),
    );
    // С поиском найденные по имени — выше найденных по метке, адресу или
    // заметке; внутри ступени — выбранная сортировка.
    return rankClientMatches(hits, search);
  }, [
    search,
    sorted,
    passesSearch,
    passesTag,
    passesSegment,
    passesTeam,
    passesCity,
    passesPeriod,
    passesSource,
    passesProperty,
  ]);

  // ── Контекстные счётчики попапов ─────────────────────────────────
  // «Что даст этот тап»: для каждого измерения применены все ОСТАЛЬНЫЕ
  // предикаты (свой исключён — иначе счётчики схлопывались бы к уже
  // выбранному). Один проход по клиентам; пока попап открыт, чужие
  // фасеты меняться не могут — числа стабильны.
  const facetCounts = useMemo<FacetCounts>(
    () =>
      countFacets({
        withFacetCounts,
        clients,
        cityOptions,
        statsMap,
        index,
        passesSearch,
        passesPeriod,
        passesSegment,
        passesTeam,
        passesCity,
        passesTag,
        passesSource,
        passesProperty,
        customSources,
        propertyValueByKey,
        today: todayForSegments,
      }),
    [
      withFacetCounts,
      clients,
      cityOptions,
      statsMap,
      index,
      passesSearch,
      passesPeriod,
      passesSegment,
      passesTeam,
      passesCity,
      passesTag,
      passesSource,
      passesProperty,
      customSources,
      propertyValueByKey,
      todayForSegments,
    ],
  );

  // ── Токены summary-бара ──────────────────────────────────────────
  const activeTokens = useMemo<ActiveToken[]>(
    () =>
      activeFilterTokens(
        {
          segments,
          selectedTeams,
          selectedCities,
          activeTags,
          period,
          sources,
          propertyTypes,
        },
        { teamOptions, cityOptions, tagOptions, sourceOptions },
      ),
    [
      segments,
      selectedTeams,
      selectedCities,
      activeTags,
      period,
      sources,
      propertyTypes,
      teamOptions,
      cityOptions,
      tagOptions,
      sourceOptions,
    ],
  );

  // Бейдж считает ровно то, что можно снять токеном: значение по мёртвому
  // id (удалённый тег/команда) токена не даёт и в счёт не идёт — иначе
  // бейдж показывал бы фильтр, которого пользователь не видит.
  const activeCount = activeTokens.length;

  return {
    filtered,
    activeTokens,
    activeCount,
    teamOptions,
    cityOptions,
    tagOptions,
    propertyOptions,
    sourceOptions,
    facetCounts,
    hasSourceData,
    hasPropertyData,
  };
}
