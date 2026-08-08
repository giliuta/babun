import { useMemo } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { nameInComment } from "@babun/shared/local/selectors/client-stats";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  clientPropertyTypes,
  propertyTypeLabel,
  clientSource,
  matchesSegment,
  sortClients,
  periodLabel,
  todayYMD,
  SEGMENT_OPTIONS,
  SOURCE_OPTIONS,
  type ActiveToken,
  type ClientsFilter,
  type FacetOption,
  type SegmentKey,
  type SortKey,
} from "./filter";

// Волна 2 — порт web useClientFilters (v812): один хук владеет
// отфильтрованным списком, опциями фасетов и токенами бара.
// Отличие от веба — структура мемо: сортировка живёт в СВОЁМ
// useMemo (deps: clients/sort/statsMap), а предикаты применяются к уже
// отсортированному списку. Фильтр сохраняет порядок → результат
// идентичен вебу, но клавиатурный ввод в поиске НЕ перегоняет
// O(n log n) localeCompare-компаратор (фикс Волны 1 — не откатывать).

/** Контекстные счётчики рядов попапов (веб-парити facetCounts):
 *  «сколько клиентов даст этот тап» — все ДРУГИЕ фасеты + период +
 *  поиск применены, собственный фасет исключён. */
export interface FacetCounts {
  segment: Record<SegmentKey, number>;
  city: Record<string, number>;
  tag: Record<string, number>;
  team: Record<string, number>;
  source: Record<string, number>;
  property: Record<string, number>;
  /** «Виновник нуля»: сколько клиентов осталось бы, сними мы РОВНО одно
   *  условие. Ключи: search · period · segment · city · tag · team ·
   *  source · property. Считается тем же проходом, что и счётчики. */
  withoutOne: Record<string, number>;
}

const EMPTY_WITHOUT_ONE: Record<string, number> = {
  search: 0,
  period: 0,
  segment: 0,
  city: 0,
  tag: 0,
  team: 0,
  source: 0,
  property: 0,
};

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
  facetCounts: FacetCounts;
  /** Строки Источник/Тип объекта появляются, когда данные есть хоть у
   *  одного клиента — пустой справочник не даёт мёртвую строку. */
  hasSourceData: boolean;
  hasPropertyData: boolean;
}

/** Свободная нормализация имени — зеркалит seed-fallback buildStatsMap. */
function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ClientAppointmentIndex {
  /** clientId → множество team_id по записям клиента. */
  clientTeams: Map<string, Set<string>>;
  /** clientId → список дат записей (YYYY-MM-DD). */
  clientApptDates: Map<string, string[]>;
}

/** Один проход по записям — два индекса по клиенту. Включая fallback по
 *  имени в comment для seed-записей с client_id:null (как buildStatsMap). */
export function buildClientAppointmentIndex(
  clients: Client[],
  appointments: Appointment[],
): ClientAppointmentIndex {
  const byId = new Map<string, Appointment[]>();
  const orphanByName = new Map<string, Appointment[]>();
  for (const a of appointments) {
    // A cancelled visit is not part of the relationship history. Counting
    // it here made clients appear under a team/period even when their only
    // record in that facet had been cancelled.
    if (a.status === "cancelled") continue;
    if (a.client_id) {
      const arr = byId.get(a.client_id);
      if (arr) arr.push(a);
      else byId.set(a.client_id, [a]);
    } else {
      const key = normName(a.comment);
      if (key) {
        const arr = orphanByName.get(key);
        if (arr) arr.push(a);
        else orphanByName.set(key, [a]);
      }
    }
  }

  const clientTeams = new Map<string, Set<string>>();
  const clientApptDates = new Map<string, string[]>();
  for (const c of clients) {
    const own = byId.get(c.id) ?? [];
    let combined: Appointment[];
    if (orphanByName.size > 0) {
      const cname = normName(c.full_name);
      const orphans: Appointment[] = [];
      for (const [name, arr] of orphanByName) {
        // Границы слова — как в buildStatsMap (короткое имя не ловит
        // подстроку: «Ан» не матчит «диван»).
        if (nameInComment(name, cname)) orphans.push(...arr);
      }
      combined = orphans.length === 0 ? own : own.concat(orphans);
    } else {
      combined = own;
    }
    const teamSet = new Set<string>();
    const dates: string[] = [];
    for (const a of combined) {
      if (a.team_id) teamSet.add(a.team_id);
      if (a.date) dates.push(a.date);
    }
    clientTeams.set(c.id, teamSet);
    clientApptDates.set(c.id, dates);
  }
  return { clientTeams, clientApptDates };
}

/** Минимальная структурная форма команды — хук читает только id/name/
 *  color, так что подходят и shared Team, и Supabase-row из useTeams(). */
interface TeamLike {
  id: string;
  name: string;
  color: string | null;
}

/** Минимальная форма метки библиотеки (cities) — имя+цвет, порядок массива
 *  = порядок библиотеки (useCities уже отдаёт по position). */
interface CityLike {
  name: string;
  color: string | null;
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
  // Вся библиотека сразу (решение владельца 2026-07-22): фасеты
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

  const cityOptions = useMemo<FacetOption[]>(() => {
    // ВСЯ библиотека меток Кабинета (порядок position, цвет метки) +
    // legacy-хвост: свободные значения client.city, не совпавшие с
    // библиотекой trim/case-insensitive, — по алфавиту с avatar-цветом.
    // «Прочее»-корзины нет: каждое значение — отдельный удаляемый токен.
    const used = new Map<string, string>(); // norm → как написано у клиента
    for (const c of clients) {
      const city = (c.city ?? "").trim();
      if (!city) continue;
      const norm = city.toLowerCase();
      if (!used.has(norm)) used.set(norm, city);
    }
    const options: FacetOption[] = [];
    for (const lib of cities) {
      const name = lib.name.trim();
      if (!name) continue;
      used.delete(name.toLowerCase());
      options.push({
        value: name,
        label: name,
        color: lib.color ?? getAvatarColor(name),
      });
    }
    const legacy = [...used.values()].sort((a, b) => a.localeCompare(b, "ru"));
    for (const city of legacy) {
      options.push({
        value: city,
        label: city,
        color: getAvatarColor(city),
        legacy: true,
      });
    }
    return options;
  }, [clients, cities]);

  const propertyOptions = useMemo<FacetOption[]>(() => {
    // ИЗ ФАКТОВ, а не из зашитого перечисления. Строка выбора на объекте
    // пишет в `loc.label` живые слова бизнеса («Дом», «Склад», «Бокс»), а
    // фасет предлагал шесть значений старого enum'а (house/apartment/…) —
    // выбрать можно было только то, чего в данных нет, и фильтр честно
    // отдавал пустой список (аудит 2026-07-27).
    //
    // Порядок: по частоте, при равенстве по алфавиту — как во всех фасетах,
    // где словарь принадлежит бизнесу, а не нам. Legacy-значения enum'а
    // переводятся в человеческую подпись и живут наравне.
    const uses = new Map<string, { value: string; count: number }>();
    for (const c of clients) {
      for (const value of clientPropertyTypes(c)) {
        const key = value.trim().toLowerCase();
        if (!key) continue;
        const prev = uses.get(key);
        if (prev) prev.count += 1;
        else uses.set(key, { value, count: 1 });
      }
    }
    return [...uses.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          propertyTypeLabel(a.value).localeCompare(
            propertyTypeLabel(b.value),
            "ru",
          ),
      )
      .map(({ value }) => ({
        value,
        label: propertyTypeLabel(value),
        color: "",
      }));
  }, [clients]);

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
  const passesSearch = useMemo(() => {
    const q = search.trim();
    return (c: Client) => (q ? matchesClient(c, search) : true);
  }, [search]);

  // Одна дата на весь проход фильтра. Пересчитывается вместе с набором
  // статусов и картой статистики — этого достаточно: экран живёт минуты,
  // а не сутки, и рассинхрон со счётчиками попапа закрыт.
  const todayForSegments = todayYMD();
  const passesSegment = useMemo(() => {
    // OR по выбранным статусам («список на обзвон»: любой из выбранных) —
    // единая семантика с Метка/Теги/Команда. AND давал ловушку: второй
    // статус сужал в ноль, а счётчиков, объяснявших это, на контролах
    // больше нет (решение владельца 2026-07-22).
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
    const sel = selectedCities.map((s) => s.trim().toLowerCase());
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      return sel.includes((c.city ?? "").trim().toLowerCase());
    };
  }, [selectedCities]);

  const passesTag = useMemo(() => {
    const sel = activeTags;
    // OR-внутри фасета — единая семантика с Команда/Метка: показать
    // клиентов с ЛЮБЫМ из выбранных тегов (между секциями остаётся AND).
    return (c: Client): boolean =>
      sel.length === 0 || sel.some((t) => c.tag_ids.includes(t));
  }, [activeTags]);

  const passesSource = useMemo(() => {
    const sel = sources as string[];
    return (c: Client): boolean =>
      sel.length === 0 || sel.includes(clientSource(c));
  }, [sources]);

  const passesProperty = useMemo(() => {
    const sel = propertyTypes as string[];
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      const own = clientPropertyTypes(c);
      return sel.some((p) => own.has(p));
    };
  }, [propertyTypes]);

  // Строки-фильтры «портрета» появляются, только когда данные есть.
  const hasSourceData = useMemo(
    () => clients.some((c) => clientSource(c) !== "unknown"),
    [clients],
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
    return sorted.filter(
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
  }, [
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
  const facetCounts = useMemo<FacetCounts>(() => {
    const segment = {} as Record<SegmentKey, number>;
    for (const o of SEGMENT_OPTIONS) segment[o.key] = 0;
    const city: Record<string, number> = {};
    const tag: Record<string, number> = {};
    const team: Record<string, number> = {};
    const source: Record<string, number> = {};
    const property: Record<string, number> = {};
    // Лист закрыт — числа не видны, полный проход не нужен (иначе он бы
    // гонялся на каждую клавишу поиска у тенанта на тысячи карточек).
    if (!withFacetCounts)
      return {
        segment,
        city,
        tag,
        team,
        source,
        property,
        withoutOne: EMPTY_WITHOUT_ONE,
      };
    // client.city может отличаться регистром от канона опции.
    const cityValueByNorm = new Map(
      cityOptions.map((o) => [o.value.trim().toLowerCase(), o.value]),
    );
    // «Кто виноват в нуле»: сколько осталось бы, сними мы ровно одно
    // условие (leave-one-out). Считается тем же проходом — отдельный
    // проход по клиентам ради подсказки был бы расточительством.
    const withoutOne: Record<string, number> = {
      search: 0,
      period: 0,
      segment: 0,
      city: 0,
      tag: 0,
      team: 0,
      source: 0,
      property: 0,
    };
    const today = todayYMD();
    for (const c of clients) {
      const sr = passesSearch(c);
      const pe = passesPeriod(c);
      const seg = passesSegment(c);
      const tm = passesTeam(c);
      const ct = passesCity(c);
      const tg = passesTag(c);
      const so = passesSource(c);
      const pr = passesProperty(c);

      // Сколько прошло бы без каждого отдельного условия.
      if (pe && seg && tm && ct && tg && so && pr) withoutOne.search += 1;
      if (sr && seg && tm && ct && tg && so && pr) withoutOne.period += 1;
      if (sr && pe && tm && ct && tg && so && pr) withoutOne.segment += 1;
      if (sr && pe && seg && tm && tg && so && pr) withoutOne.city += 1;
      if (sr && pe && seg && tm && ct && so && pr) withoutOne.tag += 1;
      if (sr && pe && seg && ct && tg && so && pr) withoutOne.team += 1;
      if (sr && pe && seg && tm && ct && tg && pr) withoutOne.source += 1;
      if (sr && pe && seg && tm && ct && tg && so) withoutOne.property += 1;

      // Счётчики рядов: собственный фасет исключён, остальные применены.
      if (!sr || !pe) continue;
      if (tm && ct && tg && so && pr) {
        const s = statsMap.get(c.id);
        for (const o of SEGMENT_OPTIONS) {
          if (matchesSegment(c, o.key, s, today)) segment[o.key] += 1;
        }
      }
      if (seg && tm && tg && so && pr) {
        const norm = (c.city ?? "").trim().toLowerCase();
        const val = norm ? cityValueByNorm.get(norm) : undefined;
        if (val) city[val] = (city[val] ?? 0) + 1;
      }
      if (seg && tm && ct && so && pr) {
        for (const id of c.tag_ids) tag[id] = (tag[id] ?? 0) + 1;
      }
      if (seg && ct && tg && so && pr) {
        const set = index.clientTeams.get(c.id);
        if (set) for (const id of set) team[id] = (team[id] ?? 0) + 1;
      }
      if (seg && tm && ct && tg && pr) {
        const key = clientSource(c);
        source[key] = (source[key] ?? 0) + 1;
      }
      if (seg && tm && ct && tg && so) {
        for (const p of clientPropertyTypes(c)) {
          property[p] = (property[p] ?? 0) + 1;
        }
      }
    }
    return { segment, city, tag, team, source, property, withoutOne };
  }, [
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
  ]);

  // ── Токены summary-бара ──────────────────────────────────────────
  const activeTokens = useMemo<ActiveToken[]>(() => {
    const tokens: ActiveToken[] = [];
    for (const seg of segments) {
      const o = SEGMENT_OPTIONS.find((x) => x.key === seg);
      if (o)
        tokens.push({ key: "segment", val: seg, label: o.label, color: "" });
    }
    const teamLabel = new Map(teamOptions.map((o) => [o.value, o]));
    for (const id of selectedTeams) {
      const o = teamLabel.get(id);
      if (o)
        tokens.push({ key: "team", val: id, label: o.label, color: o.color });
    }
    const cityColor = new Map(cityOptions.map((o) => [o.value, o.color]));
    for (const city of selectedCities) {
      tokens.push({
        key: "city",
        val: city,
        label: city,
        // Цвет метки из библиотеки (как в календаре); legacy — avatar-цвет.
        color: cityColor.get(city) ?? getAvatarColor(city),
      });
    }
    const tagLabel = new Map(tagOptions.map((o) => [o.value, o]));
    for (const id of activeTags) {
      const o = tagLabel.get(id);
      if (o)
        tokens.push({ key: "tag", val: id, label: o.label, color: o.color });
    }
    if (period) {
      tokens.push({
        key: "period",
        val: period.preset,
        label: periodLabel(period),
        color: "",
      });
    }
    for (const src of sources) {
      const o = SOURCE_OPTIONS.find((x) => x.value === src);
      if (o)
        tokens.push({ key: "source", val: src, label: o.label, color: "" });
    }
    for (const p of propertyTypes) {
      // Метка бизнеса печатается как есть; раньше токен молча исчезал, если
      // значения не было в зашитом перечислении.
      tokens.push({
        key: "property",
        val: p,
        label: propertyTypeLabel(p),
        color: "",
      });
    }
    return tokens;
  }, [
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
  ]);

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
    facetCounts,
    hasSourceData,
    hasPropertyData,
  };
}
