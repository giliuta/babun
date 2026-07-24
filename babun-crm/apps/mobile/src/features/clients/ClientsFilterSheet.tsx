import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeInUp,
  FadeOutDown,
  interpolateColor,
  useDerivedValue,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown } from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { formatYMD } from "@/features/appointments/helpers";
import { periodDates } from "@/features/finances/period";
import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import {
  filterActiveCount,
  periodLabel,
  resetFilters,
  SEGMENT_BLOCKS,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type SegmentKey,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Лист «Фильтры» — полноценная страница (BottomSheet фиксированной
// высоты): ПЯТЬ СТРОК ОДНОГО ДИАЛЕКТА (решение владельца + арбитраж
// дизайн-панели 2026-07-24) — Статус · Период · Метка · Теги · Команда.
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

const INK = "#0B1220";
const SLOT = 92; // боковые слоты шапки: заголовок оптически по центру.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ── Строительные блоки ─────────────────────────────────────────────

/** Сводка строки: первый выбранный ПО КАНОНИЧЕСКОМУ ПОРЯДКУ + «+K». */
function summarize(
  options: { value: string; label: string; color?: string }[],
  selected: string[],
): { label: string; extra: number; color?: string } | null {
  if (selected.length === 0) return null;
  const chosen = options.filter((o) => selected.includes(o.value));
  if (chosen.length === 0) return null;
  return {
    label: chosen[0].label,
    extra: chosen.length - 1,
    color: chosen[0].color,
  };
}

/** Строка блока: одна тап-зона «имя + шеврон … значение». Значение —
 *  «Все» faint в покое, оттиск в чёрный при выборе; у сущностей перед
 *  значением тик цвета первой выбранной. */
function FilterRow({
  name,
  value,
  tick,
  onPress,
}: {
  name: string;
  value: { label: string; extra: number } | null;
  /** Цвет тика сущности (метка/тег/команда) — только при выборе. */
  tick?: string;
  onPress: () => void;
}) {
  const valueText = value
    ? value.label + (value.extra > 0 ? ` +${value.extra}` : "")
    : "Все";
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${valueText}`}
      accessibilityHint="Открывает выбор"
      className="flex-row items-center active:opacity-60"
      style={{
        minHeight: 48,
        borderRadius: 14,
        backgroundColor: "rgba(11,18,32,0.04)",
        paddingHorizontal: 16,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        className="text-[15px] font-semibold"
        style={{ color: INK, marginRight: 4 }}
      >
        {name}
      </Text>
      <ChevronDown color="rgba(11,18,32,0.45)" size={14} strokeWidth={2.6} />
      <View
        className="flex-row items-center"
        style={{ marginLeft: "auto", flexShrink: 1 }}
      >
        {value && tick ? (
          <View
            style={{
              width: 2,
              height: 16,
              borderRadius: 1,
              marginRight: 6,
              backgroundColor: tick,
            }}
          />
        ) : null}
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          className="text-[15px] font-bold"
          style={{
            flexShrink: 1,
            color: value ? INK : "rgba(11,18,32,0.48)",
            fontVariant: ["tabular-nums"],
          }}
        >
          {valueText}
        </Text>
      </View>
    </Pressable>
  );
}

/** Оттиск-ряд попапа: мультивыбор БЕЗ галки — выбранный ряд печатается
 *  сплошным ink с белой подписью (крашфейд 140мс). В слоте хинта —
 *  контекстный счётчик; ряд с нулём пригашен и неактивен. */
function PickRow({
  label,
  active,
  separated,
  tick,
  count,
  hideCount,
  reduced,
  onToggle,
}: {
  label: string;
  active: boolean;
  /** Волосок к соседу сверху (внутри блока). */
  separated: boolean;
  tick?: string;
  count: number;
  hideCount: boolean;
  reduced: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const dimmed = count === 0 && !active;
  const progress = useDerivedValue(
    () => withTiming(active ? 1 : 0, { duration: reduced ? 0 : 140 }),
    [active, reduced],
  );
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(11,18,32,0)", INK],
    ),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.32)" : INK, "#FFFFFF"],
    ),
  }));
  const hintStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [t.faint, "rgba(255,255,255,0.64)"],
    ),
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: dimmed ? 0.25 : 0.45 + progress.value * 0.55,
  }));
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      disabled={dimmed}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active, disabled: dimmed }}
      accessibilityLabel={
        dimmed
          ? `${label}, нет клиентов`
          : `${label}, ${count} ${countWordRu(count, "клиент", "клиента", "клиентов")}`
      }
      className="flex-row items-center px-3.5 active:opacity-70"
      style={[
        {
          minHeight: 48,
          borderTopWidth: separated ? 1 : 0,
          borderTopColor: t.separator,
        },
        bgStyle,
      ]}
    >
      {tick ? (
        <Animated.View
          style={[
            {
              width: 2,
              height: 16,
              borderRadius: 1,
              marginRight: 10,
              backgroundColor: tick,
            },
            tickStyle,
          ]}
        />
      ) : null}
      <Animated.Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={[
          {
            flexShrink: 1,
            fontSize: 15,
            fontWeight: active ? "600" : "500",
          },
          labelStyle,
        ]}
      >
        {label}
      </Animated.Text>
      {hideCount ? null : (
        <Animated.Text
          maxFontSizeMultiplier={1.3}
          style={[
            {
              marginLeft: "auto",
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            },
            hintStyle,
          ]}
        >
          {count}
        </Animated.Text>
      )}
    </AnimatedPressable>
  );
}

/** Футер-CTA — один и тот же на странице и в попапах: живой счётчик и
 *  выход на список. */
function FooterCta({
  t,
  shownCount,
  ctaLabel,
  reduced,
  onPress,
}: {
  t: ThemeColors;
  shownCount: number;
  ctaLabel: string;
  reduced: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 16) + 6,
      }}
    >
      {shownCount === 0 ? (
        <Text
          maxFontSizeMultiplier={1.3}
          className="mb-2 text-center text-[13px]"
          style={{ color: t.faint }}
        >
          Смягчите условия — период или статус
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityHint="Закрывает фильтры и показывает список"
        className="min-h-[52px] items-center justify-center overflow-hidden active:opacity-85"
        style={{
          borderRadius: 14,
          backgroundColor: shownCount === 0 ? "rgba(11,18,32,0.04)" : t.accent,
        }}
      >
        <Animated.Text
          key={ctaLabel}
          entering={reduced ? undefined : FadeInUp.duration(160)}
          exiting={reduced ? undefined : FadeOutDown.duration(120)}
          maxFontSizeMultiplier={1.3}
          className="text-[17px] font-semibold"
          style={{
            color: shownCount === 0 ? "rgba(11,18,32,0.45)" : t.onAccent,
            fontVariant: ["tabular-nums"],
          }}
        >
          {ctaLabel}
        </Animated.Text>
      </Pressable>
    </View>
  );
}

/** Попап мультивыбора — общая грамматика четырёх блоков: контейнеры
 *  попапа периода (блоки canvas без подписей, ряды 48), отметка =
 *  оттиск. Live-apply, тап НЕ закрывает; закрывает CTA (попап И лист)
 *  или скрим/свайп (возврат на страницу). */
function MultiPickSheet({
  visible,
  title,
  blocks,
  selected,
  counts,
  shownCount,
  ctaLabel,
  reduced,
  onToggle,
  onClose,
  onShow,
}: {
  visible: boolean;
  title: string;
  blocks: FacetOption[][];
  selected: string[];
  counts: Record<string, number>;
  shownCount: number;
  ctaLabel: string;
  reduced: boolean;
  onToggle: (value: string) => void;
  onClose: () => void;
  onShow: () => void;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  // При крупном шрифте подпись важнее числа — счётчик уступает место.
  const hideCount = fontScale >= 1.6;
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.85}>
      <Text
        accessibilityRole="header"
        className="px-5 pt-1 text-lg font-bold"
        style={{ color: t.ink, marginBottom: 12 }}
      >
        {title}
      </Text>
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
      >
        {blocks.map((block, bi) =>
          block.length === 0 ? null : (
            <View
              key={bi}
              className="mb-2 overflow-hidden rounded-xl"
              style={{ backgroundColor: t.canvas }}
            >
              {block.map((o, i) => (
                <PickRow
                  key={o.value}
                  label={o.label}
                  active={selected.includes(o.value)}
                  separated={i > 0}
                  tick={o.color || undefined}
                  count={counts[o.value] ?? 0}
                  hideCount={hideCount}
                  reduced={reduced}
                  onToggle={() => onToggle(o.value)}
                />
              ))}
            </View>
          ),
        )}
      </ScrollView>
      <FooterCta
        t={t}
        shownCount={shownCount}
        ctaLabel={ctaLabel}
        reduced={reduced}
        onPress={onShow}
      />
    </BottomSheet>
  );
}

// ── Панель ─────────────────────────────────────────────────────────

type FacetSheet = "segment" | "city" | "tag" | "team";

export function ClientsFilterSheet({
  visible,
  filter,
  result,
  dataFrom,
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: ClientsFilter;
  result: ClientFilterResult;
  /** Дата первой записи (YYYY-MM-DD) — даты «Всего времени» в сплите. */
  dataFrom: string | null;
  onChange: (f: ClientsFilter) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { height: winH } = useWindowDimensions();

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [openFacet, setOpenFacet] = useState<FacetSheet | null>(null);

  // «Сбросить» с прощением: 4 секунды можно «Вернуть» снятый набор.
  const [undo, setUndo] = useState<ClientsFilter | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setPresetsOpen(false);
      setWheelsOpen(false);
      setOpenFacet(null);
      setUndo(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const { filtered, teamOptions, cityOptions, tagOptions, facetCounts } =
    result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;

  // Полная страница: высота окна минус верхний зазор и грабер листа.
  const pageH = winH - insets.top - 29;

  const countPart = `${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;
  const ctaLabel =
    shownCount === 0 ? "Ничего не найдено" : `Показать ${countPart}`;

  // Live-apply нем для VoiceOver — дебаунс-анонс счётчика (один анонсер
  // на состояние — работает и при открытом попапе).
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(
      () =>
        AccessibilityInfo.announceForAccessibility(
          shownCount === 0 ? "Ничего не найдено" : `Найдено ${countPart}`,
        ),
      500,
    );
    return () => clearTimeout(id);
  }, [visible, shownCount, countPart]);

  // «Возле названия видно, что выбрано»: компактная сводка активного
  // набора под заголовком — единственный композитный взгляд, когда
  // строки накрыты попапом. Порядок групп = порядок строк.
  const activeSummary = nothingActive
    ? null
    : [
        ...(filter.period ? [periodLabel(filter.period)] : []),
        ...filter.segments.map(
          (k) => SEGMENT_OPTIONS.find((o) => o.key === k)?.label ?? k,
        ),
        ...filter.selectedCities,
        ...filter.activeTags
          .map((id) => tagOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
        ...filter.selectedTeams
          .map((id) => teamOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
      ].join(" · ");

  // Сплит периода (диалект Финансов): слева имя, справа всегда даты —
  // у «Всего времени» это честный охват данных «с первой записи по
  // сегодня». Тот же диапазон сидит и в колёсах, и в подсказке попапа.
  const now = new Date();
  const todayYmd = formatYMD(now);
  const spanFrom = dataFrom && dataFrom < todayYmd ? dataFrom : todayYmd;
  const allSpanDates = dataFrom
    ? periodDates({ preset: "custom", from: spanFrom, to: todayYmd })
    : null;
  const periodName = filter.period ? periodLabel(filter.period) : "Всё время";
  const datesLabel = filter.period
    ? periodDates(filter.period)
    : (allSpanDates ?? "—");
  const draftFrom =
    filter.period?.from ??
    (dataFrom && dataFrom < todayYmd
      ? dataFrom
      : formatYMD(new Date(now.getFullYear(), now.getMonth(), 1)));
  const draftTo = filter.period?.to ?? todayYmd;

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const onReset = () => {
    haptics.tap();
    if (undo) {
      onChange(undo);
      setUndo(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      return;
    }
    if (nothingActive) return;
    setUndo(filter);
    onChange(resetFilters());
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 4000);
  };

  // ── Конфигурация четырёх попапов одной грамматики ────────────────
  const segmentAsOptions = SEGMENT_OPTIONS.map((s) => ({
    value: s.key as string,
    label: s.label,
    color: "",
  }));
  const segmentBlocks: FacetOption[][] = SEGMENT_BLOCKS.map((block) =>
    block.map((key) => ({
      value: key as string,
      label: SEGMENT_OPTIONS.find((o) => o.key === key)?.label ?? key,
      color: "",
    })),
  );
  const facetConfig: Record<
    FacetSheet,
    {
      title: string;
      blocks: FacetOption[][];
      selected: string[];
      counts: Record<string, number>;
      toggle: (v: string) => void;
    }
  > = {
    segment: {
      title: "Статус",
      blocks: segmentBlocks,
      selected: filter.segments,
      counts: facetCounts.segment,
      toggle: (v) =>
        onChange({
          ...filter,
          segments: toggleIn(filter.segments, v) as SegmentKey[],
        }),
    },
    city: {
      title: "Метка",
      // Библиотека и legacy-хвост — отдельными блоками без подписей.
      blocks: [
        cityOptions.filter((o) => !o.legacy),
        cityOptions.filter((o) => o.legacy),
      ],
      selected: filter.selectedCities,
      counts: facetCounts.city,
      toggle: (v) =>
        onChange({
          ...filter,
          selectedCities: toggleIn(filter.selectedCities, v),
        }),
    },
    tag: {
      title: "Теги",
      blocks: [tagOptions],
      selected: filter.activeTags,
      counts: facetCounts.tag,
      toggle: (v) =>
        onChange({ ...filter, activeTags: toggleIn(filter.activeTags, v) }),
    },
    team: {
      title: "Команда",
      blocks: [teamOptions],
      selected: filter.selectedTeams,
      counts: facetCounts.team,
      toggle: (v) =>
        onChange({
          ...filter,
          selectedTeams: toggleIn(filter.selectedTeams, v),
        }),
    },
  };

  // Сводки строк — первый выбранный по каноническому порядку + «+K».
  const segmentValue = summarize(segmentAsOptions, filter.segments);
  const cityValue = summarize(cityOptions, filter.selectedCities);
  const tagValue = summarize(tagOptions, filter.activeTags);
  const teamValue = summarize(teamOptions, filter.selectedTeams);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={1}>
      <View style={{ height: pageH }}>
        {/* Шапка 92│центр│92 — «Фильтры» оптически по центру всегда. */}
        <View className="flex-row items-center px-5 pb-1">
          <View style={{ width: SLOT }} />
          <View className="flex-1 items-center">
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              className="text-[17px] font-semibold"
              style={{ color: INK }}
            >
              Фильтры
            </Text>
            {activeSummary ? (
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  marginTop: 1,
                  fontSize: 12,
                  fontWeight: "500",
                  color: "rgba(11,18,32,0.48)",
                }}
              >
                {activeSummary}
              </Text>
            ) : null}
          </View>
          <View style={{ width: SLOT, alignItems: "flex-end" }}>
            <Pressable
              onPress={onReset}
              disabled={nothingActive && !undo}
              accessibilityRole="button"
              accessibilityLabel={undo ? "Вернуть фильтры" : "Сбросить фильтры"}
              accessibilityState={{ disabled: nothingActive && !undo }}
              hitSlop={8}
              className="min-h-11 justify-center active:opacity-60"
            >
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                className="text-[15px] font-semibold"
                style={{
                  color: nothingActive && !undo ? t.faint : t.accent,
                }}
              >
                {undo ? "Вернуть" : "Сбросить"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Страница-бланк: два абзаца строк (12 внутри, 28 между),
            прижаты к шапке, ниже — намеренная пустота до футера.
            Паддинги ТОЛЬКО через contentContainerStyle (NativeWind
            роняет className на ScrollView). */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: 28,
            gap: 28,
          }}
        >
          {/* ── Абзац «когда и кого» ── */}
          <View style={{ gap: 12 }}>
            {/* Период: сплит Финансов — имя → пресеты, даты → колёса. */}
            <View
              className="flex-row items-stretch"
              style={{
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: "rgba(11,18,32,0.04)",
              }}
            >
              <Pressable
                onPress={() => {
                  haptics.tap();
                  setPresetsOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Период: ${periodName}. Выбрать пресет`}
                className="flex-1 flex-row items-center pl-4 pr-2 active:opacity-60"
                style={{ gap: 4 }}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  className="shrink text-[15px] font-semibold"
                  style={{ color: INK }}
                >
                  {periodName}
                </Text>
                <ChevronDown
                  color="rgba(11,18,32,0.45)"
                  size={14}
                  strokeWidth={2.6}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  haptics.tap();
                  setWheelsOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Даты: ${datesLabel}. Выбрать диапазон`}
                className="flex-row items-center pl-2 pr-4 active:opacity-60"
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  className="text-[15px] font-bold"
                  style={{
                    color: filter.period ? INK : "rgba(11,18,32,0.48)",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {datesLabel}
                </Text>
              </Pressable>
            </View>

            <FilterRow
              name="Статус"
              value={segmentValue}
              onPress={() => setOpenFacet("segment")}
            />
          </View>

          {/* ── Абзац «чьих» ── */}
          <View style={{ gap: 12 }}>
            {cityOptions.length > 0 ? (
              <FilterRow
                name="Метка"
                value={cityValue}
                tick={cityValue?.color}
                onPress={() => setOpenFacet("city")}
              />
            ) : null}
            {tagOptions.length > 0 ? (
              <FilterRow
                name="Теги"
                value={tagValue}
                tick={tagValue?.color}
                onPress={() => setOpenFacet("tag")}
              />
            ) : null}
            {/* Фильтр по единственной команде бессмыслен — строка
                появляется со второй командой. */}
            {teamOptions.length >= 2 ? (
              <FilterRow
                name="Команда"
                value={teamValue}
                tick={teamValue?.color}
                onPress={() => setOpenFacet("team")}
              />
            ) : null}
          </View>
        </ScrollView>

        <FooterCta
          t={t}
          shownCount={shownCount}
          ctaLabel={ctaLabel}
          reduced={reduced}
          onPress={onClose}
        />
      </View>

      {/* Попапы — модал поверх модала: вложены в дерево листа, iOS
          показывает их цепочкой. */}
      {(Object.keys(facetConfig) as FacetSheet[]).map((key) => {
        const cfg = facetConfig[key];
        return (
          <MultiPickSheet
            key={key}
            visible={openFacet === key}
            title={cfg.title}
            blocks={cfg.blocks}
            selected={cfg.selected}
            counts={cfg.counts}
            shownCount={shownCount}
            ctaLabel={ctaLabel}
            reduced={reduced}
            onToggle={cfg.toggle}
            onClose={() => setOpenFacet(null)}
            onShow={() => {
              setOpenFacet(null);
              onClose();
            }}
          />
        );
      })}

      <PeriodPresetModal
        visible={presetsOpen}
        current={filter.period}
        businessNow={now}
        allTime={{
          active: !filter.period,
          hint: allSpanDates ?? undefined,
          onSelect: () => onChange({ ...filter, period: null }),
        }}
        onClose={() => setPresetsOpen(false)}
        onApply={(p) => onChange({ ...filter, period: p })}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={{
          preset: filter.period?.preset ?? "custom",
          from: draftFrom,
          to: draftTo,
        }}
        onClose={() => setWheelsOpen(false)}
        onApply={(p) => onChange({ ...filter, period: p })}
      />
    </BottomSheet>
  );
}
