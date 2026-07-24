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
import { useThemeColors } from "@/theme/colors";
import { formatYMD } from "@/features/appointments/helpers";
import { periodDates } from "@/features/finances/period";
import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import {
  CORE_SEGMENTS,
  filterActiveCount,
  periodLabel,
  resetFilters,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type SegmentCounts,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Лист «Фильтры» — полноценная страница (решение владельца 2026-07-24:
// лист выезжает снизу ДО КОНЦА вверх; эксперимент с детентами закрыт).
// Канонический BottomSheet, контент фиксированной высоты «в экран».
// Грамматика «Оттиск»: ВЫБРАННОЕ ПЕЧАТАЕТСЯ ЧЁРНЫМ — ink-заливка
// #0B1220 с белой подписью (letterpress, буквальное «чёрное не серое»);
// никаких галок, тинтов и цветных бордеров — заливка и есть состояние.
// Idle-материал ячеек выведен из ink (rgba 4%), не из серого пигмента.
// Цвет сущности — вертикальный тик-эмаль у левого края (45% в покое,
// 100% на оттиске). Кобальт живёт ровно в двух местах: CTA и
// «Сбросить/Вернуть». Заголовки — капс 11/700 с гравировальной
// линейкой до края. ПЕРИОД — диалект Финансов один в один: сплит-строка
// «имя … даты» (имя открывает попап пресетов, даты — колёса С–До);
// вместо заголовка секции строка сама читается «Всё время». Всё LIVE:
// счётчик в CTA и сводка выбранного под заголовком.

const INK = "#0B1220";
const SLOT = 92; // боковые слоты шапки: заголовок оптически по центру.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ── Строительные блоки ─────────────────────────────────────────────

/** Заголовок секции: капс 11/700 + гравировальная линейка до края. */
function SectionHead({ title }: { title: string }) {
  return (
    <View className="flex-row items-center" style={{ gap: 10, minHeight: 20 }}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "rgba(11,18,32,0.48)",
        }}
      >
        {title}
      </Text>
      <View
        style={{ flex: 1, height: 1, backgroundColor: "rgba(11,18,32,0.10)" }}
      />
    </View>
  );
}

/** ЕДИНАЯ ячейка листа — «оттиск»: idle rgba(ink,4%), выбранная —
 *  сплошной ink с белой подписью (крашфейд 140мс), без галок. Цвет
 *  сущности — тик 2×16 у левого края. Слот под галку не нужен —
 *  подпись не двигается по построению. Dynamic Type ≥1.2 → 1 колонка. */
function Cell({
  label,
  active,
  dimmed,
  tick,
  checkbox,
  reduced,
  onPress,
}: {
  label: string;
  active: boolean;
  /** Ядро-статус с нулём клиентов: на месте, но пригашен и неактивен. */
  dimmed?: boolean;
  /** Цвет сущности (метка/тег/команда) — вертикальный тик-эмаль. */
  tick?: string;
  checkbox?: boolean;
  reduced: boolean;
  onPress: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const oneCol = fontScale >= 1.2;
  const progress = useDerivedValue(
    () => withTiming(active ? 1 : 0, { duration: reduced ? 0 : 140 }),
    [active, reduced],
  );
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.02)" : "rgba(11,18,32,0.04)", INK],
    ),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.32)" : INK, "#FFFFFF"],
    ),
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + progress.value * 0.55,
  }));
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={dimmed}
      accessibilityRole={checkbox ? "checkbox" : "button"}
      accessibilityState={
        checkbox
          ? { checked: active, disabled: !!dimmed }
          : { selected: active, disabled: !!dimmed }
      }
      accessibilityLabel={label}
      className="items-center justify-center px-3 active:opacity-80"
      style={[
        {
          flexBasis: oneCol ? "100%" : "47%",
          flexGrow: 1,
          minHeight: 44,
          borderRadius: 14,
        },
        bgStyle,
      ]}
    >
      {tick ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 12,
              width: 2,
              height: 16,
              borderRadius: 1,
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
            fontSize: 15,
            fontWeight: active ? "600" : "500",
            fontVariant: ["tabular-nums"],
          },
          labelStyle,
        ]}
      >
        {label}
      </Animated.Text>
    </AnimatedPressable>
  );
}

/** Сетка фасета: 2 колонки, нечётный хвост держит фантом, больше 6 —
 *  «Ещё N» полуячейкой в потоке (выбранные из хвоста не прячутся). */
const FACET_VISIBLE_LIMIT = 6;

function FacetGrid({
  options,
  selected,
  reduced,
  onToggle,
}: {
  options: FacetOption[];
  selected: string[];
  reduced: boolean;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = options.length > FACET_VISIBLE_LIMIT;
  const shown =
    overflow && !expanded
      ? [
          ...options.slice(0, FACET_VISIBLE_LIMIT),
          ...options
            .slice(FACET_VISIBLE_LIMIT)
            .filter((o) => selected.includes(o.value)),
        ]
      : options;
  const hiddenCount = options.length - shown.length;
  const cellCount = shown.length + (overflow ? 1 : 0);
  return (
    <View className="flex-row flex-wrap gap-2">
      {shown.map((o) => (
        <Cell
          key={o.value}
          label={o.label}
          active={selected.includes(o.value)}
          tick={o.color || undefined}
          checkbox
          reduced={reduced}
          onPress={() => onToggle(o.value)}
        />
      ))}
      {overflow ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            setExpanded(!expanded);
          }}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Свернуть" : `Ещё ${hiddenCount}`}
          className="items-center justify-center active:opacity-70"
          style={{
            flexBasis: "47%",
            flexGrow: 1,
            minHeight: 44,
            borderRadius: 14,
            backgroundColor: "rgba(11,18,32,0.04)",
          }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: "rgba(11,18,32,0.45)",
            }}
          >
            {expanded ? "Свернуть" : `Ещё ${hiddenCount}`}
          </Text>
        </Pressable>
      ) : null}
      {/* Нечётный хвост НЕ тянется на всю ширину — фантом держит колонку. */}
      {cellCount % 2 === 1 ? (
        <View style={{ flexBasis: "47%", flexGrow: 1 }} />
      ) : null}
    </View>
  );
}

// ── Панель ─────────────────────────────────────────────────────────

export function ClientsFilterSheet({
  visible,
  filter,
  result,
  segmentCounts,
  dataFrom,
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: ClientsFilter;
  result: ClientFilterResult;
  segmentCounts: SegmentCounts;
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

  // «Сбросить» с прощением: 4 секунды можно «Вернуть» снятый набор.
  const [undo, setUndo] = useState<ClientsFilter | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setPresetsOpen(false);
      setWheelsOpen(false);
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

  const { filtered, teamOptions, cityOptions, tagOptions } = result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;

  // Полная страница: высота окна минус верхний зазор и грабер листа.
  const pageH = winH - insets.top - 29;

  const countPart = `${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;
  const ctaLabel =
    shownCount === 0 ? "Ничего не найдено" : `Показать ${countPart}`;

  // Live-apply нем для VoiceOver — дебаунс-анонс счётчика.
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

  // «Возле названия видно, что выбрано» (владелец): компактная сводка
  // активного набора под заголовком — список позади скрыт страницей.
  const activeSummary = nothingActive
    ? null
    : [
        ...filter.segments.map(
          (k) => SEGMENT_OPTIONS.find((o) => o.key === k)?.label ?? k,
        ),
        ...(filter.period ? [periodLabel(filter.period)] : []),
        ...filter.selectedCities,
        ...filter.activeTags
          .map((id) => tagOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
        ...filter.selectedTeams
          .map((id) => teamOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
      ].join(" · ");

  // Ядро-«дела» стоит на постоянных местах ВСЕГДА (при нуле — пригашено);
  // редкие статусы появляются только при наличии клиентов.
  const availableSegments = SEGMENT_OPTIONS.filter(
    (s) =>
      CORE_SEGMENTS.has(s.key) ||
      segmentCounts[s.key] > 0 ||
      filter.segments.includes(s.key),
  );

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

        {/* Стек все-видно-сразу — страница целиком, контент скроллится
            свободно. Паддинги ТОЛЬКО через contentContainerStyle
            (NativeWind роняет className на ScrollView). */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: 28,
            gap: 28,
          }}
        >
          {/* ── Статус: ежедневное ядро — первым ── */}
          <View className="gap-3">
            <SectionHead title="Статус" />
            <View className="flex-row flex-wrap gap-2">
              {availableSegments.map((s) => {
                // Мультивыбор (ИЛИ — объединение, «список на обзвон»).
                const on = filter.segments.includes(s.key);
                const dead =
                  CORE_SEGMENTS.has(s.key) &&
                  segmentCounts[s.key] === 0 &&
                  !on;
                return (
                  <Cell
                    key={s.key}
                    label={s.label}
                    active={on}
                    checkbox
                    dimmed={dead}
                    reduced={reduced}
                    onPress={() =>
                      onChange({
                        ...filter,
                        segments: on
                          ? filter.segments.filter((x) => x !== s.key)
                          : [...filter.segments, s.key],
                      })
                    }
                  />
                );
              })}
              {availableSegments.length % 2 === 1 ? (
                <View style={{ flexBasis: "47%", flexGrow: 1 }} />
              ) : null}
            </View>
          </View>

          {/* ── Период: сплит Финансов без заголовка секции — строка сама
              читается «Всё время … даты». Имя → пресеты, даты → колёса. */}
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

          {/* ── Метка · Теги · Команда: вся библиотека, OR-внутри ── */}
          {cityOptions.length > 0 ? (
            <View className="gap-3">
              <SectionHead title="Метка" />
              <FacetGrid
                options={cityOptions}
                selected={filter.selectedCities}
                reduced={reduced}
                onToggle={(v) =>
                  onChange({
                    ...filter,
                    selectedCities: toggleIn(filter.selectedCities, v),
                  })
                }
              />
            </View>
          ) : null}

          {tagOptions.length > 0 ? (
            <View className="gap-3">
              <SectionHead title="Теги" />
              <FacetGrid
                options={tagOptions}
                selected={filter.activeTags}
                reduced={reduced}
                onToggle={(v) =>
                  onChange({
                    ...filter,
                    activeTags: toggleIn(filter.activeTags, v),
                  })
                }
              />
            </View>
          ) : null}

          {teamOptions.length > 0 ? (
            <View className="gap-3">
              <SectionHead title="Команда" />
              <FacetGrid
                options={teamOptions}
                selected={filter.selectedTeams}
                reduced={reduced}
                onToggle={(v) =>
                  onChange({
                    ...filter,
                    selectedTeams: toggleIn(filter.selectedTeams, v),
                  })
                }
              />
            </View>
          ) : null}
        </ScrollView>

        {/* Футер: CTA со счётчиком — единственный «живой» элемент листа. */}
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
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            className="min-h-[52px] items-center justify-center overflow-hidden active:opacity-85"
            style={{
              borderRadius: 14,
              backgroundColor:
                shownCount === 0 ? "rgba(11,18,32,0.04)" : t.accent,
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
      </View>

      {/* Попапы периода — общие с Финансами (модал поверх модала:
          вложены в дерево листа, iOS показывает их цепочкой). */}
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
        current={{ preset: filter.period?.preset ?? "custom", from: draftFrom, to: draftTo }}
        onClose={() => setWheelsOpen(false)}
        onApply={(p) => onChange({ ...filter, period: p })}
      />
    </BottomSheet>
  );
}
