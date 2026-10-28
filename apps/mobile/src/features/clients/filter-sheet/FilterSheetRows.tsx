import { Pressable, ScrollView, Text, View } from "react-native";
import { BarChart3, ChevronRight } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { SORT_LABELS_LONG, type ClientsFilter, type SortKey } from "../filter";
import type { FacetConfig, FacetSheet } from "./facet-config";
import { FilterRow } from "./FilterRow";
import { InlineMultiPick, InlineSinglePick } from "./InlinePick";
import { PeriodSplitRow } from "./PeriodSplitRow";

type RowValue = { label: string; extra: number; color?: string } | null;

/** Прокручиваемые строки листа «Фильтры»: сортировка, период и фасеты. */
export function FilterSheetRows({
  filter,
  sort,
  periodName,
  datesLabel,
  values,
  hasCities,
  hasTags,
  hasTeams,
  hideTeam,
  hasSourceData,
  hasPropertyData,
  objectsOn,
  onOpenSort,
  onOpenPresets,
  onOpenWheels,
  onOpenFacet,
  onAnalytics,
  expanded,
  facetConfig,
  sortBlocks,
  reduced,
  onSortChange,
}: {
  filter: ClientsFilter;
  sort: SortKey;
  periodName: string;
  datesLabel: string;
  /** Сводки строк — первый выбранный по каноническому порядку + «+K». */
  values: Record<FacetSheet, RowValue>;
  hasCities: boolean;
  hasTags: boolean;
  hasTeams: boolean;
  hideTeam: boolean;
  hasSourceData: boolean;
  hasPropertyData: boolean;
  objectsOn: boolean;
  onOpenSort: () => void;
  onOpenPresets: () => void;
  onOpenWheels: () => void;
  onOpenFacet: (facet: FacetSheet) => void;
  onAnalytics?: () => void;
  /** Что раскрыто под строкой: фасет, сортировка или ничего. Раскрыта
   *  всегда одна строка. */
  expanded: FacetSheet | "sort" | null;
  facetConfig: Record<FacetSheet, FacetConfig>;
  sortBlocks: { value: string; label: string }[][];
  reduced: boolean;
  onSortChange: (s: SortKey) => void;
}) {
  const t = useThemeColors();
  // Строка фасета и её варианты — одним абзацем: раскрытое живёт прямо под
  // своей строкой (InlinePick.tsx), а не шторкой поверх листа.
  const facet = (key: FacetSheet, name: string, value: RowValue, tick?: string) => {
    const cfg = facetConfig[key];
    const open = expanded === key;
    return (
      <View key={key} style={{ gap: 8 }}>
        <FilterRow
          name={name}
          value={value}
          tick={tick}
          expanded={open}
          onPress={() => onOpenFacet(key)}
        />
        {open ? (
          <InlineMultiPick
            name={name}
            subtitle={cfg.subtitle}
            blocks={cfg.blocks}
            blockTitles={cfg.blockTitles}
            rules={cfg.rules}
            selected={cfg.selected}
            counts={cfg.counts}
            reduced={reduced}
            onToggle={cfg.toggle}
            onClear={cfg.clear}
          />
        ) : null}
      </View>
    );
  };
  const segmentValue = values.segment;
  const cityValue = values.city;
  const tagValue = values.tag;
  const teamValue = values.team;
  const sourceValue = values.source;
  const propertyValue = values.property;
  return (
    /* КОМПАКТНЫЙ РИТМ: абзацы 8 внутри / 14 между, строки 44pt. 28 между
        абзацами рассчитаны на лист во весь экран — в
        половине они съедали бы место, ради которого лист и уменьшали.
        Паддинги ТОЛЬКО через contentContainerStyle (NativeWind
        роняет className на ScrollView). */
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: 12,
        paddingHorizontal: 20,
        paddingBottom: 16,
        gap: 14,
      }}
    >
      {/* ── Как показывать: сортировка отдельным абзацем — это НЕ
          фильтр (персистентна, «Сбросить» её не трогает). ── */}
      <View style={{ gap: 8 }}>
        <FilterRow
          name="Сортировка"
          value={{ label: SORT_LABELS_LONG[sort], extra: 0 }}
          expanded={expanded === "sort"}
          onPress={onOpenSort}
        />
        {expanded === "sort" ? (
          <InlineSinglePick blocks={sortBlocks} selected={sort} onSelect={(v) => onSortChange(v as SortKey)} />
        ) : null}
      </View>

      {/* ── Абзац «когда и кого» ── */}
      <View style={{ gap: 8 }}>
        {/* Период: сплит Финансов — имя → пресеты, даты → колёса.
            Волосок между половинами: без него правая часть не
            читалась как отдельная кнопка. */}
          <PeriodSplitRow
            periodName={periodName}
            datesLabel={datesLabel}
            hasPeriod={!!filter.period}
            onOpenPresets={onOpenPresets}
            onOpenWheels={onOpenWheels}
          />

        {facet("segment", "Статус", segmentValue)}
      </View>

      {/* ── Абзац «чьих» — обёртка гейтится, иначе пустой абзац
          оставлял дыру в 56pt (gap сверху + снизу). ── */}
      {hasCities ||
      hasTags ||
      (!hideTeam && hasTeams) ? (
      <View style={{ gap: 12 }}>
        {hasCities ? facet("city", "Метка", cityValue, cityValue?.color) : null}
        {hasTags ? facet("tag", "Теги", tagValue, tagValue?.color) : null}
        {!hideTeam && hasTeams ? facet("team", "Команда", teamValue, teamValue?.color) : null}
      </View>
      ) : null}

      {/* ── Абзац «портрет»: строки появляются, когда данные есть, но
          УЖЕ ВЫБРАННОЕ держит строку видимой (иначе фильтр не снять). ── */}
      {hasSourceData ||
      hasPropertyData ||
      filter.sources.length > 0 ||
      (objectsOn && filter.propertyTypes.length > 0) ? (
        <View style={{ gap: 12 }}>
          {hasSourceData || filter.sources.length > 0
            ? facet("source", "Источник", sourceValue)
            : null}
          {hasPropertyData || (objectsOn && filter.propertyTypes.length > 0)
            ? facet("property", "Тип объекта", propertyValue)
            : null}
        </View>
      ) : null}

      {/* ── Дверь «Аналитика» — строка, а не кнопка: уводит на свою
          страницу, как двери настроек. ── */}
      {onAnalytics ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onAnalytics();
          }}
          accessibilityRole="button"
          accessibilityLabel="Аналитика по клиентам"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
            paddingVertical: 8,
            paddingHorizontal: 16,
            borderRadius: t.radius.card,
            backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
          })}
        >
          <BarChart3 color={t.sub} size={18} strokeWidth={2} />
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            Аналитика
          </Text>
          <ChevronRight color={t.chevron} size={16} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
