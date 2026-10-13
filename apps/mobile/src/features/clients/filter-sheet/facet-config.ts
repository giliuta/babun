// The facet popups of the «Фильтры» sheet as data: one config per facet
// (title, rows, counts, toggle). Pure — the sheet maps it onto
// `MultiPickSheet`.

import type { PropertyType } from "@babun/shared/local/clients";
import {
  SEGMENT_BLOCKS,
  SEGMENT_BLOCK_TITLES,
  SEGMENT_OPTIONS,
  SEGMENT_RULES,
  FACET_SUBTITLES,
  SORT_BLOCKS,
  SORT_LABELS_LONG,
  type ClientsFilter,
  type FacetOption,
  type SegmentKey,
} from "../filter";
import type { ClientFilterResult } from "../useClientFilters";
import { toggleIn } from "./sheet-text";

export type FacetSheet = "segment" | "city" | "tag" | "team" | "source" | "property";

export interface FacetConfig {
  title: string;
  subtitle: string;
  blocks: FacetOption[][];
  /** Имена блоков — только у «Статуса»: у остальных фасетов блок один. */
  blockTitles?: string[];
  rules?: Record<string, string>;
  selected: string[];
  counts: Record<string, number>;
  toggle: (v: string) => void;
  clear: () => void;
}

/** Статусы как опции фасета — для сводки строки «Статус». */
export function segmentAsOptions(): FacetOption[] {
  return SEGMENT_OPTIONS.map((s) => ({
    value: s.key as string,
    label: s.label,
    color: "",
  }));
}

/** Сортировка — всегда одно значение (не «Все»), персистентна; блоки
 *  время · деньги · алфавит. */
export function sortBlocksOf(): { value: string; label: string }[][] {
  return SORT_BLOCKS.map((block) =>
    block.map((k) => ({ value: k as string, label: SORT_LABELS_LONG[k] })),
  );
}

/** Конфигурация попапов одной грамматики. */
export function buildFacetConfig(
  filter: ClientsFilter,
  result: Pick<
    ClientFilterResult,
    "cityOptions" | "tagOptions" | "teamOptions" | "sourceOptions" | "propertyOptions" | "facetCounts"
  >,
  applyFilter: (next: ClientsFilter) => void,
): Record<FacetSheet, FacetConfig> {
  const { cityOptions, tagOptions, teamOptions, facetCounts } = result;
  // ТИКА У СТАТУСОВ НЕТ (владелец 2026-08-07: «убери жёлтые штучки
  // должников слева, всё в одном стиле»). Цветная полоска — признак
  // СУЩНОСТИ со своим цветом (метка, тег, команда); у статуса цвета нет,
  // и раскрашенные ряды рвали ровный список на пёстрый.
  const segmentBlocks: FacetOption[][] = SEGMENT_BLOCKS.map((block) =>
    block.map((key) => ({
      value: key as string,
      label: SEGMENT_OPTIONS.find((o) => o.key === key)?.label ?? key,
      color: "",
    })),
  );
  return {
    segment: {
      title: "Статус",
      subtitle: FACET_SUBTITLES.segment,
      blocks: segmentBlocks,
      blockTitles: SEGMENT_BLOCK_TITLES,
      rules: SEGMENT_RULES,
      selected: filter.segments,
      counts: facetCounts.segment,
      toggle: (v) =>
        applyFilter({
          ...filter,
          segments: toggleIn(filter.segments, v) as SegmentKey[],
        }),
      clear: () => applyFilter({ ...filter, segments: [] }),
    },
    city: {
      title: "Метка",
      subtitle: FACET_SUBTITLES.city,
      // Библиотека и legacy-хвост — отдельными блоками без подписей.
      blocks: [
        cityOptions.filter((o) => !o.legacy),
        cityOptions.filter((o) => o.legacy),
      ],
      selected: filter.selectedCities,
      counts: facetCounts.city,
      toggle: (v) =>
        applyFilter({
          ...filter,
          selectedCities: toggleIn(filter.selectedCities, v),
        }),
      clear: () => applyFilter({ ...filter, selectedCities: [] }),
    },
    tag: {
      title: "Теги",
      subtitle: FACET_SUBTITLES.tag,
      blocks: [tagOptions],
      selected: filter.activeTags,
      counts: facetCounts.tag,
      toggle: (v) =>
        applyFilter({ ...filter, activeTags: toggleIn(filter.activeTags, v) }),
      clear: () => applyFilter({ ...filter, activeTags: [] }),
    },
    team: {
      title: "Команда",
      subtitle: FACET_SUBTITLES.team,
      blocks: [teamOptions],
      selected: filter.selectedTeams,
      counts: facetCounts.team,
      toggle: (v) =>
        applyFilter({
          ...filter,
          selectedTeams: toggleIn(filter.selectedTeams, v),
        }),
      clear: () => applyFilter({ ...filter, selectedTeams: [] }),
    },
    source: {
      title: "Источник",
      subtitle: FACET_SUBTITLES.source,
      blocks: [result.sourceOptions],
      selected: filter.sources,
      counts: facetCounts.source,
      toggle: (v) =>
        applyFilter({
          ...filter,
          sources: toggleIn(filter.sources, v),
        }),
      clear: () => applyFilter({ ...filter, sources: [] }),
    },
    property: {
      title: "Тип объекта",
      subtitle: FACET_SUBTITLES.property,
      blocks: [result.propertyOptions],
      selected: filter.propertyTypes,
      counts: facetCounts.property,
      toggle: (v) =>
        applyFilter({
          ...filter,
          propertyTypes: toggleIn(filter.propertyTypes, v) as PropertyType[],
        }),
      clear: () => applyFilter({ ...filter, propertyTypes: [] }),
    },
  };
}
