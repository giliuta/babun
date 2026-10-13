import { AccessibilityInfo } from "react-native";
import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import {
  FACET_SUBTITLES,
  SORT_LABELS_LONG,
  type ClientsFilter,
  type SortKey,
} from "../filter";
import type { FacetConfig, FacetSheet } from "./facet-config";
import { MultiPickSheet } from "./MultiPickSheet";
import { SinglePickSheet } from "./SinglePickSheet";

/** Попапы листа «Фильтры»: фасеты, сортировка и период. */
export function FilterSheetPopups({
  facetConfig,
  openFacet,
  setOpenFacet,
  shownCount,
  zeroHint,
  reduced,
  sortOpen,
  setSortOpen,
  sortBlocks,
  sort,
  onSortChange,
  presetsOpen,
  setPresetsOpen,
  wheelsOpen,
  setWheelsOpen,
  filter,
  now,
  allSpanDates,
  draftFrom,
  draftTo,
  applyFilter,
}: {
  facetConfig: Record<FacetSheet, FacetConfig>;
  openFacet: FacetSheet | null;
  setOpenFacet: (facet: FacetSheet | null) => void;
  shownCount: number;
  zeroHint: string | null;
  reduced: boolean;
  sortOpen: boolean;
  setSortOpen: (open: boolean) => void;
  sortBlocks: { value: string; label: string }[][];
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  presetsOpen: boolean;
  setPresetsOpen: (open: boolean) => void;
  wheelsOpen: boolean;
  setWheelsOpen: (open: boolean) => void;
  filter: ClientsFilter;
  now: Date;
  allSpanDates: string | null;
  draftFrom: string;
  draftTo: string;
  applyFilter: (next: ClientsFilter) => void;
}) {
  return (
    <>
      {/* Попапы — модал поверх модала: вложены в дерево листа, iOS
          показывает их цепочкой. */}
      {(Object.keys(facetConfig) as FacetSheet[]).map((key) => {
        const cfg = facetConfig[key];
        return (
          <MultiPickSheet
            key={key}
            visible={openFacet === key}
            title={cfg.title}
            subtitle={cfg.subtitle}
            blocks={cfg.blocks}
            blockTitles={cfg.blockTitles}
            rules={cfg.rules}
            selected={cfg.selected}
            counts={cfg.counts}
            shownCount={shownCount}
            zeroHint={zeroHint}
            reduced={reduced}
            onToggle={cfg.toggle}
            onClear={cfg.clear}
            onClose={() => setOpenFacet(null)}
          />
        );
      })}

      <SinglePickSheet
        visible={sortOpen}
        title="Сортировка"
        subtitle={FACET_SUBTITLES.sort}
        blocks={sortBlocks}
        selected={sort}
        onSelect={(v) => {
          onSortChange(v as SortKey);
          // Анонс — после закрытия попапа, иначе VoiceOver перебивает сам
          // себя объявлением уходящего экрана.
          setTimeout(
            () =>
              AccessibilityInfo.announceForAccessibility(
                `Отсортировано: ${SORT_LABELS_LONG[v as SortKey]}`,
              ),
            350,
          );
        }}
        onClose={() => setSortOpen(false)}
      />

      <PeriodPresetModal
        visible={presetsOpen}
        current={filter.period}
        businessNow={now}
        allTime={{
          active: !filter.period,
          hint: allSpanDates ?? undefined,
          onSelect: () => applyFilter({ ...filter, period: null }),
        }}
        onClose={() => setPresetsOpen(false)}
        onApply={(p) => applyFilter({ ...filter, period: p })}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={{
          preset: filter.period?.preset ?? "custom",
          from: draftFrom,
          to: draftTo,
        }}
        onClose={() => setWheelsOpen(false)}
        onApply={(p) => applyFilter({ ...filter, period: p })}
      />
    </>
  );
}
