import { Pressable, ScrollView, Text, View } from "react-native";
import { BarChart3, ChevronRight } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { SORT_LABELS_LONG, type ClientsFilter, type SortKey } from "../filter";
import type { FacetSheet } from "./facet-config";
import { FilterRow } from "./FilterRow";
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
}) {
  const t = useThemeColors();
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
      <FilterRow
        name="Сортировка"
        value={{ label: SORT_LABELS_LONG[sort], extra: 0 }}
        onPress={onOpenSort}
      />

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

        <FilterRow
          name="Статус"
          value={segmentValue}
          onPress={() => onOpenFacet("segment")}
        />
      </View>

      {/* ── Абзац «чьих» — обёртка гейтится, иначе пустой абзац
          оставлял дыру в 56pt (gap сверху + снизу). ── */}
      {hasCities ||
      hasTags ||
      (!hideTeam && hasTeams) ? (
      <View style={{ gap: 12 }}>
        {hasCities ? (
          <FilterRow
            name="Метка"
            value={cityValue}
            tick={cityValue?.color}
            onPress={() => onOpenFacet("city")}
          />
        ) : null}
        {hasTags ? (
          <FilterRow
            name="Теги"
            value={tagValue}
            tick={tagValue?.color}
            onPress={() => onOpenFacet("tag")}
          />
        ) : null}
        {!hideTeam && hasTeams ? (
          <FilterRow
            name="Команда"
            value={teamValue}
            tick={teamValue?.color}
            onPress={() => onOpenFacet("team")}
          />
        ) : null}
      </View>
      ) : null}

      {/* ── Абзац «портрет»: строки появляются, когда данные есть, но
          УЖЕ ВЫБРАННОЕ держит строку видимой (иначе фильтр не снять). ── */}
      {hasSourceData ||
      hasPropertyData ||
      filter.sources.length > 0 ||
      (objectsOn && filter.propertyTypes.length > 0) ? (
        <View style={{ gap: 12 }}>
          {hasSourceData || filter.sources.length > 0 ? (
            <FilterRow
              name="Источник"
              value={sourceValue}
              onPress={() => onOpenFacet("source")}
            />
          ) : null}
          {hasPropertyData || (objectsOn && filter.propertyTypes.length > 0) ? (
            <FilterRow
              name="Тип объекта"
              value={propertyValue}
              onPress={() => onOpenFacet("property")}
            />
          ) : null}
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
