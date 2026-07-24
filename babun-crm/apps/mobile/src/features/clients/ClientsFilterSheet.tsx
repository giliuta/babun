import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  interpolateColor,
  useDerivedValue,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import {
  DetentSheet,
  type Detent,
  type DetentSheetHandle,
} from "@/components/ui/DetentSheet";
import { useThemeColors } from "@/theme/colors";
import { parseYMD, formatYMD } from "@/features/appointments/helpers";
import { formatShortDateRu } from "./format";
import { PeriodBand } from "./PeriodBand";
import {
  CORE_SEGMENTS,
  filterActiveCount,
  periodLabel,
  resetFilters,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type PeriodMonth,
  type SegmentCounts,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Лист «Фильтры» — канон «ОТТИСК + ЛЕНТА» (решение руководителя по
// брейншторму 3 идеаторов + арбитра, 2026-07-23). Немодальный
// DetentSheet (половина экрана без скрима, список позади живой) +
// стек все-видно-сразу. Грамматика «Оттиск»: ВЫБРАННОЕ ПЕЧАТАЕТСЯ
// ЧЁРНЫМ — ink-заливка #0B1220 с белой подписью (letterpress,
// буквальное «чёрное не серое»); никаких галок, тинтов и цветных
// бордеров — заливка и есть состояние. Idle-материал ячеек выведен из
// ink (rgba 4%), не из серого пигмента. Цвет сущности — вертикальный
// тик-эмаль у левого края (45% в покое, 100% на оттиске). Кобальт
// живёт ровно в двух местах: CTA и «Сбросить/Вернуть». Заголовки —
// капс 11/700 с гравировальной линейкой до края. ПЕРИОД — сигнатурная
// «лента времени» (PeriodBand): 12 месяцев с гравюрой плотности
// записей, тап = месяц, штрих = диапазон; точные даты — колёса С–До по
// тапу на значение. Движение: ничто не меняет позицию, только
// проявляется (крашфейд 140мс, ролл счётчика CTA). Всё LIVE.

const INK = "#0B1220";
const SLOT = 92; // боковые слоты шапки: заголовок оптически по центру.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ── Строительные блоки ─────────────────────────────────────────────

/** Заголовок секции: капс 11/700 + гравировальная линейка до края;
 *  справа — опциональное живое значение (Период). */
function SectionHead({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
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
      {right}
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
  full,
  dimmed,
  tick,
  radio,
  checkbox,
  reduced,
  onPress,
}: {
  label: string;
  active: boolean;
  /** Полноширинная ячейка. */
  full?: boolean;
  /** Ядро-статус с нулём клиентов: на месте, но пригашен и неактивен. */
  dimmed?: boolean;
  /** Цвет сущности (метка/тег/команда) — вертикальный тик-эмаль. */
  tick?: string;
  radio?: boolean;
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
      accessibilityRole={radio ? "radio" : checkbox ? "checkbox" : "button"}
      accessibilityState={
        checkbox
          ? { checked: active, disabled: !!dimmed }
          : { selected: active, disabled: !!dimmed }
      }
      accessibilityLabel={label}
      className="items-center justify-center px-3 active:opacity-80"
      style={[
        {
          flexBasis: full || oneCol ? "100%" : "47%",
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
  months,
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: ClientsFilter;
  result: ClientFilterResult;
  segmentCounts: SegmentCounts;
  /** Окно ленты времени: 12 месяцев с плотностью записей. */
  months: PeriodMonth[];
  onChange: (f: ClientsFilter) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const sheetRef = useRef<DetentSheetHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [detent, setDetent] = useState<Detent>("medium");

  const [wheelsOpen, setWheelsOpen] = useState(false);
  // Какой край диапазона крутит единственное колесо (диалект Финансов).
  const [side, setSide] = useState<"from" | "to">("from");
  const wheelsY = useRef(0);

  // «Сбросить» с прощением: 4 секунды можно «Вернуть» снятый набор.
  const [undo, setUndo] = useState<ClientsFilter | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setWheelsOpen(false);
      setSide("from");
      setDetent("medium");
      setUndo(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    }
  }, [visible]);

  useEffect(() => {
    if (filter.period === null) {
      setWheelsOpen(false);
      setSide("from");
    }
  }, [filter.period]);

  // Возврат на половину — контент к началу: свёрнутый лист всегда
  // показывает голову стека, а не случайный обрез прокрутки.
  useEffect(() => {
    if (detent === "medium") {
      scrollRef.current?.scrollTo({ y: 0, animated: !reduced });
    }
  }, [detent, reduced]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const { filtered, teamOptions, cityOptions, tagOptions } = result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;

  // Честный глагол: на половине список уже виден — кнопка лишь закрывает.
  const countPart = `${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;
  const ctaLabel =
    shownCount === 0
      ? "Ничего не найдено"
      : detent === "medium"
        ? `Готово · ${countPart}`
        : `Показать ${countPart}`;

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
  // активного набора под заголовком — читается и на полной странице,
  // когда список позади скрыт.
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

  // Сид колёс: «с начала месяца — по сегодня».
  const now = new Date();
  const draftFrom =
    filter.period?.from ??
    formatYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  const draftTo = filter.period?.to ?? formatYMD(now);

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const setCustomRange = (from: string, to: string) => {
    const [f, tt] = from <= to ? [from, to] : [to, from];
    onChange({ ...filter, period: { preset: "custom", from: f, to: tt } });
  };

  const openWheels = () => {
    haptics.tap();
    const next = !wheelsOpen;
    setWheelsOpen(next);
    if (next) {
      sheetRef.current?.expand();
      setDetent("large");
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({
            y: Math.max(0, wheelsY.current - 72),
            animated: !reduced,
          }),
        120,
      );
    }
  };

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

  // Сегмент «С | До» (диалект Финансов): выбирает край, одно колесо крутит.
  const rangeSegment = (key: "from" | "to", label: string, value: string) => {
    const active = side === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${label}: ${formatShortDateRu(value)}`}
        onPress={() => {
          haptics.tap();
          setSide(key);
        }}
        className="flex-1 items-center justify-center"
        style={{
          minHeight: 46,
          paddingVertical: 6,
          borderRadius: 10,
          backgroundColor: active ? t.surface : "transparent",
        }}
      >
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: active ? INK : "rgba(11,18,32,0.45)" }}
        >
          {label}
        </Text>
        <Text
          className="text-[15px] font-semibold"
          style={{ color: INK, fontVariant: ["tabular-nums"] }}
        >
          {formatShortDateRu(value)}
        </Text>
      </Pressable>
    );
  };

  const footer = (
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
          backgroundColor: shownCount === 0 ? "rgba(11,18,32,0.04)" : t.accent,
        }}
      >
        {/* Ролл счётчика — единственный «живой» элемент листа: пульс
            перестройки списка позади. */}
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

  return (
    <DetentSheet
      ref={sheetRef}
      visible={visible}
      onClose={onClose}
      onDetentChange={setDetent}
      footer={footer}
    >
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

      {/* Стек все-видно-сразу. Scroll-to-expand: на medium свайп тела
          поднимает ЛИСТ (DetentSheet), контент скроллится только на
          large — обрезков под шапкой не бывает. Паддинги ТОЛЬКО через
          contentContainerStyle (NativeWind роняет className). */}
      <ScrollView
        ref={scrollRef}
        scrollEnabled={detent === "large"}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 10,
          paddingHorizontal: 20,
          paddingBottom: 140,
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

        {/* ── Период: лента времени (сигнатура) ── */}
        <View className="gap-3">
          <SectionHead
            title="Период"
            right={
              <Pressable
                onPress={openWheels}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityState={{ expanded: wheelsOpen }}
                accessibilityLabel={`Период: ${
                  filter.period ? periodLabel(filter.period) : "Всё время"
                }. Точные даты`}
                className="active:opacity-60"
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: filter.period ? INK : "rgba(11,18,32,0.48)",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {filter.period ? periodLabel(filter.period) : "Всё время"}
                </Text>
              </Pressable>
            }
          />
          <PeriodBand
            months={months}
            period={filter.period}
            onChange={(p) => onChange({ ...filter, period: p })}
          />
          {wheelsOpen ? (
            <Animated.View
              entering={reduced ? undefined : FadeInDown.duration(180)}
              exiting={reduced ? undefined : FadeOut.duration(120)}
              onLayout={(e) => {
                wheelsY.current = e.nativeEvent.layout.y;
              }}
              className="p-3"
              style={{
                borderRadius: t.radius.card,
                backgroundColor: t.canvas,
              }}
            >
              {/* С | До — точные дни и диапазоны старше окна ленты. */}
              <View
                className="mb-2 flex-row p-1"
                style={{
                  borderRadius: 14,
                  backgroundColor: "rgba(11,18,32,0.04)",
                  gap: 4,
                }}
              >
                {rangeSegment("from", "С", draftFrom)}
                {rangeSegment("to", "До", draftTo)}
              </View>
              <View className="items-center">
                <DateTimePicker
                  themeVariant="light"
                  value={parseYMD(side === "from" ? draftFrom : draftTo)}
                  mode="date"
                  display="spinner"
                  locale="ru-RU"
                  onChange={(_, d) => {
                    if (!d) return;
                    if (side === "from") setCustomRange(formatYMD(d), draftTo);
                    else setCustomRange(draftFrom, formatYMD(d));
                  }}
                />
              </View>
            </Animated.View>
          ) : null}
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
    </DetentSheet>
  );
}
