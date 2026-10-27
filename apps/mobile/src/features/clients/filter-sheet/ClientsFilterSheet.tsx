import { useFeatureOn } from "@/features/settings/company-features";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pluralPhraseRu } from "@babun/shared/common/utils/plural-ru";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useThemeColors } from "@/theme/colors";
import {
  filterActiveCount,
  type ClientsFilter,
  type SortKey,
} from "../filter";
import type { ClientFilterResult } from "../useClientFilters";
import { useReduceMotion } from "@/lib/reduce-motion";
import { GRABBER_H, HALF_RATIO, TOP_GAP } from "./constants";
import {
  buildFacetConfig,
  segmentAsOptions,
  sortBlocksOf,
  type FacetSheet,
} from "./facet-config";
import { FilterSheetHeader } from "./FilterSheetHeader";
import { FilterSheetPopups } from "./FilterSheetPopups";
import { FilterSheetRows } from "./FilterSheetRows";
import { FooterCta } from "./FooterCta";
import {
  activeSummaryOf,
  periodSplit,
  summarize,
  zeroHintFor,
} from "./sheet-text";
import {
  filterSheetActions,
  useCountAnnouncement,
  useFilterSheetState,
} from "./use-filter-sheet-state";

// Лист «Фильтры» — полноценная страница (BottomSheet фиксированной
// высоты): ПЯТЬ СТРОК ОДНОГО ДИАЛЕКТА — Статус · Период · Метка · Теги · Команда.
// Каждая строка = «имя 15/600 + шеврон … значение 15/700 tabular»
// (грамматика строки периода); весь выбор уезжает в попапы
// канонического BottomSheet. Системное правило: ГАЛКА = одиночный
// выбор, тап применяет и закрывает (попап пресетов периода — эталон);
// ОТТИСК = мультивыбор, попап остаётся открытым (ряд печатается
// сплошным ink #0B1220 с белой подписью — галок нет). В слоте хинта
// рядов — контекстный счётчик «что даст этот тап» (facetCounts);
// ряд с нулём пригашен. Живой CTA «Показать N» дублируется в футере
// попапа и закрывает всё разом. Кобальт — только CTA и
// «Сбросить/Вернуть». Всё LIVE: счётчик CTA + сводка под заголовком.

export function ClientsFilterSheet({
  visible,
  filter,
  result,
  dataFrom,
  dataTo,
  search,
  onClearSearch,
  initialFacet,
  sort,
  onSortChange,
  onChange,
  onClose,
  hideTeam = false,
  onAnalytics,
}: {
  visible: boolean;
  filter: ClientsFilter;
  result: ClientFilterResult;
  /** Первая/последняя записи (YYYY-MM-DD) — честный охват «Всего времени». */
  dataFrom: string | null;
  dataTo: string | null;
  /** Строка поиска — участвует во всех числах листа, поэтому видна в сводке
   *  и снимается вместе с фильтрами («Сбросить» чистит и её). */
  search: string;
  onClearSearch: (next: string) => void;
  /** С каким измерением открыть лист (тап по телу токена в баре). */
  initialFacet?: FacetSheet | null;
  /** Сортировка списка — персистентная настройка (sort-pref), НЕ фильтр;
   *  «Сбросить» её не трогает. Живёт первой строкой листа. */
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onChange: (f: ClientsFilter) => void;
  onClose: () => void;
  /** Команду выбирает лента над списком — строка «Команда» здесь
   *  была бы вторым, спорящим с ней фильтром. */
  hideTeam?: boolean;
  /** Дверь «Аналитика» последней строкой: значок справа в шапке
   *  открывает фильтры, а аналитика живёт внутри них. */
  onAnalytics?: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { height: winH } = useWindowDimensions();

  const sheet = useFilterSheetState(visible, initialFacet);
  const { undo, setUndo } = sheet;

  const {
    filtered,
    teamOptions,
    cityOptions,
    tagOptions,
    facetCounts,
    hasSourceData,
    hasPropertyData: propertyDataRaw,
  } = result;
  // Объекты выключены у компании (STORY-088) — фильтра по их типу нет.
  const objectsOn = useFeatureOn("objects");
  const hasPropertyData = objectsOn && propertyDataRaw;
  const shownCount = filtered.length;
  const trimmedSearch = search.trim();
  // Поиск — часть набора: без этого при активном запросе «Сбросить» была
  // мертва и из «ноль клиентов» не было выхода прямо из листа.
  const nothingActive = filterActiveCount(filter) === 0 && !trimmedSearch;

  // ПОЛОВИНА ЭКРАНА, А НЕ СТРАНИЦА, как открывается всё остальное. Лист во
  // весь рост читался бы как отдельный экран и прятал список, ради которого
  // фильтр и открывают: под половинным видно, что именно меняется. Содержимое не режется —
  // строки прокручиваются внутри, футер остаётся на месте.
  const pageH = Math.round(
    (winH - insets.top - GRABBER_H - TOP_GAP) * HALF_RATIO,
  );

  const countPart = `${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;
  // Винительный падеж: «Показать 1 клиентА» (у «Готово · 1 клиент» —
  // именительный, там число просто называется). «1 клиента» — своя фраза:
  // то же слово после 2 в других языках читается множественным.
  const countAcc = pluralPhraseRu(
    shownCount,
    `${shownCount} клиента`,
    `${shownCount} ${countWordRu(shownCount, "клиента", "клиента", "клиентов")}`,
  );

  const zeroHint = zeroHintFor(shownCount, facetCounts.withoutOne, filter, trimmedSearch);

  useCountAnnouncement(visible, shownCount, countPart);

  const activeSummary = activeSummaryOf({
    filter,
    search,
    nothingActive,
    tagOptions,
    teamOptions,
    sourceOptions: result.sourceOptions,
  });

  const now = new Date();
  const { allSpanDates, periodName, datesLabel, draftFrom, draftTo } = periodSplit(
    filter.period,
    dataFrom,
    dataTo,
    now,
  );

  const { applyFilter, onReset } = filterSheetActions({
    filter,
    search,
    nothingActive,
    undo,
    setUndo,
    onChange,
    onClearSearch,
  });

  const facetConfig = buildFacetConfig(filter, result, applyFilter);
  const sortBlocks = sortBlocksOf();

  // Сводки строк — первый выбранный по каноническому порядку + «+K».
  const values = {
    segment: summarize(segmentAsOptions(), filter.segments),
    city: summarize(cityOptions, filter.selectedCities),
    tag: summarize(tagOptions, filter.activeTags),
    team: summarize(teamOptions, filter.selectedTeams),
    source: summarize(result.sourceOptions, filter.sources),
    property: summarize(result.propertyOptions, filter.propertyTypes),
  };

  return (
    <BottomSheet padded={false} visible={visible} onClose={onClose} maxHeightRatio={HALF_RATIO}>
      <View style={{ height: pageH }}>
        <FilterSheetHeader
          nothingActive={nothingActive}
          undo={!!undo}
          activeSummary={activeSummary}
          onReset={onReset}
        />

        <FilterSheetRows
          filter={filter}
          sort={sort}
          periodName={periodName}
          datesLabel={datesLabel}
          values={values}
          hasCities={cityOptions.length > 0}
          hasTags={tagOptions.length > 0}
          hasTeams={teamOptions.length > 0}
          hideTeam={hideTeam}
          hasSourceData={hasSourceData}
          hasPropertyData={hasPropertyData}
          objectsOn={objectsOn}
          onOpenSort={() => sheet.setSortOpen(true)}
          onOpenPresets={() => sheet.setPresetsOpen(true)}
          onOpenWheels={() => sheet.setWheelsOpen(true)}
          onOpenFacet={sheet.setOpenFacet}
          onAnalytics={onAnalytics}
        />

        <FooterCta
          t={t}
          verb={shownCount === 0 ? "К списку" : "Показать "}
          roll={shownCount === 0 ? null : countAcc}
          hint={zeroHint}
          a11yLabel={shownCount === 0 ? "К списку" : `Показать ${countAcc}`}
          a11yHint={
            shownCount === 0
              ? "Закрывает фильтры"
              : "Закрывает фильтры и показывает список"
          }
          onPress={onClose}
        />
      </View>

      <FilterSheetPopups
        facetConfig={facetConfig}
        openFacet={sheet.openFacet}
        setOpenFacet={sheet.setOpenFacet}
        shownCount={shownCount}
        zeroHint={zeroHint}
        reduced={reduced}
        sortOpen={sheet.sortOpen}
        setSortOpen={sheet.setSortOpen}
        sortBlocks={sortBlocks}
        sort={sort}
        onSortChange={onSortChange}
        presetsOpen={sheet.presetsOpen}
        setPresetsOpen={sheet.setPresetsOpen}
        wheelsOpen={sheet.wheelsOpen}
        setWheelsOpen={sheet.setWheelsOpen}
        filter={filter}
        now={now}
        allSpanDates={allSpanDates}
        draftFrom={draftFrom}
        draftTo={draftTo}
        applyFilter={applyFilter}
      />
    </BottomSheet>
  );
}
