import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  clientPropertyTypes,
  matchesSegment,
  SEGMENT_OPTIONS,
  type FacetOption,
  type SegmentKey,
} from "../filter";
import { sourceBucket, type ClientSource } from "../acquisition-source";
import type { ClientAppointmentIndex } from "./appointment-index";
import { propertyKey } from "./options";

// Contextual row counters of the facet popups, one pass over the clients.

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

/** A facet predicate closed over the current filter state. */
type ClientPredicate = (c: Client) => boolean;

interface FacetCountsInput {
  withFacetCounts: boolean;
  clients: Client[];
  cityOptions: FacetOption[];
  statsMap: Map<string, ClientStats>;
  index: ClientAppointmentIndex;
  passesSearch: ClientPredicate;
  passesPeriod: ClientPredicate;
  passesSegment: ClientPredicate;
  passesTeam: ClientPredicate;
  passesCity: ClientPredicate;
  passesTag: ClientPredicate;
  passesSource: ClientPredicate;
  passesProperty: ClientPredicate;
  customSources: ClientSource[];
  /** Lower-cased object type → the facet option value. */
  propertyValueByKey: Map<string, string>;
  /** «Сегодня» компании — та же дата, что у списка (`useBusinessToday`). */
  today: string;
}

export function countFacets(input: FacetCountsInput): FacetCounts {
  const {
    today,
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
  } = input;
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
      const key = sourceBucket(c.acquisition_source, customSources, c.team_id);
      source[key] = (source[key] ?? 0) + 1;
    }
    if (seg && tm && ct && tg && so) {
      const own = new Set([...clientPropertyTypes(c)].map(propertyKey));
      for (const key of own) {
        const value = propertyValueByKey.get(key);
        if (value) property[value] = (property[value] ?? 0) + 1;
      }
    }
  }
  return { segment, city, tag, team, source, property, withoutOne };
}
