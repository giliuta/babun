import {
  PROPERTY_LABELS,
  type Client,
  type PropertyType,
} from "@babun/shared/local/clients";
import type { SegmentKey } from "./filter/segments";
import type { PeriodValue } from "./filter/period";

// Волна 2 — web-parity типы/константы фильтров клиентов. Порт
// apps/web/.../clients/filters/{types.ts,useClientFilters.ts} (v812).
// Чистый модуль без React — хук живёт в useClientFilters.ts.
//
// Public entry: sort lives in `./filter/sort`, status segments in
// `./filter/segments`, the period label in `./filter/period`.

export {
  clientDebt,
  DEFAULT_SORT,
  SORT_BLOCKS,
  SORT_LABELS_LONG,
  SORT_ORDER,
  sortClients,
  type SortKey,
} from "./filter/sort";
export {
  BIRTHDAY_DAYS,
  FACET_SUBTITLES,
  LOYAL_VISITS,
  matchesSegment,
  NEW_DAYS,
  OUTREACH_SEGMENTS,
  SEGMENT_BLOCK_TITLES,
  SEGMENT_BLOCKS,
  SEGMENT_OPTIONS,
  SEGMENT_RULES,
  segmentEvidence,
  todayYMD,
  type Segment,
  type SegmentKey,
} from "./filter/segments";
export { periodLabel, type PeriodValue } from "./filter/period";

// ── Источник · Язык · Тип объекта ──────────────────────────────────

// Варианты источника (готовые + свои команд) — `acquisition-source.ts`.

// LEGACY-ПЕРЕЧИСЛЕНИЕ ТИПОВ ОБЪЕКТА — только словарь ПЕРЕВОДА.
//
// Живой словарь принадлежит бизнесу: строка выбора на объекте пишет в
// `loc.label` его собственные слова («Дом», «Склад», «Бокс»), и фасет фильтра
// собирается из фактических значений (useClientFilters.propertyOptions).
// Здесь остались шесть значений старого enum'а — их надо уметь ПОКАЗАТЬ
// человеку у клиентов, заведённых до перехода, и не более того. Предлагать их
// как варианты выбора нельзя: у нового бизнеса таких значений в данных нет, и
// фильтр честно отдавал пустой список.
const PROPERTY_ORDER: PropertyType[] = [
  "apartment",
  "house",
  "office",
  "restaurant",
  "shop",
  "other",
];

const PROPERTY_OPTIONS = PROPERTY_ORDER.map((key) => ({
  value: key as string,
  label: PROPERTY_LABELS[key],
  color: "",
}));

/** Типы объектов клиента. Метка — это и есть тип объекта (дом, офис, вилла
 *  и свои). Значит словарь принадлежит БИЗНЕСУ (пресеты кабинета «Типы объектов»), а не
 *  зашитому перечислению — для SaaS это единственно верно: у автомойки свои
 *  типы, у кондиционерщиков свои.
 *
 *  Поэтому фасет собирает и метки объектов, и legacy-перечисление (у старых
 *  клиентов оно заполнено, и терять его нельзя). */
export function clientPropertyTypes(c: Client): Set<string> {
  const out = new Set<string>();
  if (c.property_type) out.add(c.property_type);
  for (const loc of c.locations ?? []) {
    if (loc.property_type) out.add(loc.property_type);
    const label = loc.label?.trim();
    if (label) out.add(label);
  }
  return out;
}

/** Человеческая подпись значения фасета: legacy-перечисление переводим, а
 *  метку бизнеса печатаем как есть — она уже на его языке. */
export function propertyTypeLabel(value: string): string {
  return PROPERTY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ── Facets / tokens ────────────────────────────────────────────────

type FacetKey = "team" | "city" | "tag";

/** Значение внутри фасет-попапа (Команда / Метка / Тег). */
export interface FacetOption {
  value: string;
  label: string;
  /** Цвет тика сущности (hex/rgba). */
  color: string;
  /** Метка вне библиотеки (свободный legacy-город) — отдельный блок. */
  legacy?: boolean;
}

/** Удаляемый токен в summary-баре. */
export interface ActiveToken {
  key: FacetKey | "period" | "segment" | "source" | "property";
  val: string;
  label: string;
  /** Пустая строка → без точки (период/сегмент/источник/тип). */
  color: string;
}

// ── Filter state ───────────────────────────────────────────────────

export interface ClientsFilter {
  /** Выбранные статусы — OR-семантика («список на обзвон»: любой из
   *  выбранных), как у всех фасетов листа. Пусто = все. */
  segments: SegmentKey[];
  selectedTeams: string[];
  selectedCities: string[];
  activeTags: string[];
  period: PeriodValue | null;
  /** Корзины источника: имя строки (`n:instagram`) или «unknown». */
  sources: string[];
  propertyTypes: PropertyType[];
}

export const EMPTY_FILTER: ClientsFilter = {
  segments: [],
  selectedTeams: [],
  selectedCities: [],
  activeTags: [],
  period: null,
  sources: [],
  propertyTypes: [],
};

/** Сколько активных ЗНАЧЕНИЙ фильтра. */
export function filterActiveCount(f: ClientsFilter): number {
  return (
    f.selectedTeams.length +
    f.selectedCities.length +
    f.activeTags.length +
    (f.period ? 1 : 0) +
    f.segments.length +
    f.sources.length +
    f.propertyTypes.length
  );
}

/** Сброс всех фильтров (сортировка — отдельная настройка, sort-pref.ts). */
export function resetFilters(): ClientsFilter {
  return { ...EMPTY_FILTER };
}
