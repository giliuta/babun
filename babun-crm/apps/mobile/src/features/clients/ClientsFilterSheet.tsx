import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Calendar,
  Check,
  ChevronDown,
  MapPin,
  Sparkles,
  Tag,
  Users,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { readableColorOnTint } from "@/components/ui/color-contrast";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { parseYMD, formatYMD } from "@/features/appointments/helpers";
import { formatShortDateRu } from "./format";
import {
  buildPeriodPresets,
  filterActiveCount,
  resetFilters,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type SegmentCounts,
  type SegmentKey,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Нижний лист «Фильтры» — «Тихий лист 2», ряды-аккордеоны (владелец,
// 2026-07-22): каждая секция — компактный ряд «иконка · название ·
// ТЕКУЩЕЕ ЗНАЧЕНИЕ справа · шеврон»; тап раскрывает под рядом лоток с
// опциями (открыт максимум один). Свёрнутый лист показывает ВСЁ
// состояние фильтра с одного взгляда в 5 рядах. Ни одного счётчика на
// контролах — число живёт ТОЛЬКО в результате (футер + бар). Опции —
// симметричная 2-колоночная сетка полноразмерных ячеек (никаких круглых
// пилюль; нечётный хвост держит фантом). Ряды: Период (пресеты Финансов
// парами «текущий/прошлый» + своё колесо С|До) · Статус (мультивыбор,
// ИЛИ; ядро-«дела» всегда на местах) · Метка/Теги/Команда (вся
// библиотека, OR-внутри, тинт цвета сущности, >6 → «Ещё N»).
// Сортировки здесь НЕТ — это настройка списка («Настройки клиентов»,
// sort-pref.ts). Всё применяется LIVE.

const SLOT = 92; // боковые слоты шапки: держат заголовок в центре и
// вмещают «Сбросить» (15/600) без клипа. Равные → заголовок оптически центр.

// Рабочие статусы диспетчера — всегда видимы на фиксированных местах.
const CORE_SEGMENTS = new Set<SegmentKey>(["debt", "noUpcoming", "reminderDue"]);

type SectionKey = "period" | "status" | "city" | "tags" | "team";

// ── Мелкие строительные блоки ──────────────────────────────────────

/** Ряд секции: иконка · название · текущее значение справа (accent при
 *  активном фильтре) · шеврон. Тап раскрывает лоток опций под рядом. */
function FilterRow({
  icon,
  title,
  value,
  active,
  open,
  onPress,
  t,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  active: boolean;
  open: boolean;
  onPress: () => void;
  t: ThemeColors;
}) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}: ${value}`}
      className="flex-row items-center px-3 active:opacity-60"
      style={{
        minHeight: 48,
        gap: 10,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      {icon}
      <Text
        maxFontSizeMultiplier={1.3}
        className="text-sm font-semibold"
        style={{ color: t.ink }}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        className="flex-1 text-right text-sm font-semibold"
        style={{ color: active ? t.accent : t.sub }}
      >
        {value}
      </Text>
      <ChevronDown
        color={t.chevron}
        size={14}
        strokeWidth={2.6}
        style={open ? { transform: [{ rotate: "180deg" }] } : undefined}
      />
    </Pressable>
  );
}

/** Лоток аккордеона: canvas-подложка под рядом, выезжает с фейдом
 *  (Reduce Motion гасит анимацию). Ячейки внутри — surface на canvas. */
function Tray({
  reduced,
  t,
  children,
}: {
  reduced: boolean;
  t: ThemeColors;
  children: ReactNode;
}) {
  return (
    <Animated.View
      entering={reduced ? undefined : FadeInDown.duration(180)}
      exiting={reduced ? undefined : FadeOut.duration(120)}
      className="p-2"
      style={{ borderRadius: t.radius.card, backgroundColor: t.canvas }}
    >
      {children}
    </Animated.View>
  );
}

/** Ячейка 2-кол грида (Статус/пресеты) — БЕЗ числа: только подпись (+
 *  галка у мультивыбора; radio-группам хватает тинта+бордера — P1-6).
 *  Слот галки зарезервирован ВСЕГДА (прозрачная) — подпись не прыгает.
 *  При крупном Dynamic Type (fontScale ≥ 1.2) грид складывается в одну
 *  колонку — канонический адаптив HIG, ничего не режется. */
function GridPill({
  label,
  active,
  full,
  radio,
  checkbox,
  idleBg,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  /** Полноширинная («Свой диапазон»); нечётный хвост держит фантом. */
  full?: boolean;
  /** Одиночный выбор (пресеты) — VoiceOver «1 из N». */
  radio?: boolean;
  /** Мультивыбор (Статус) — VoiceOver «отмечено». */
  checkbox?: boolean;
  /** Idle-заливка внутри canvas-лотка — surface вместо fill. */
  idleBg?: string;
  /** Ядро-статус с нулём клиентов: виден на месте, но пригашен. */
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const oneCol = fontScale >= 1.2;
  return (
    <Chip
      label={label}
      variant="tint"
      selected={active}
      radio={radio}
      checkbox={checkbox}
      disabled={disabled}
      dimmed={disabled}
      onPress={onPress}
      icon={
        checkbox ? (
          <Check
            color={active ? t.accent : "transparent"}
            size={14}
            strokeWidth={2.6}
          />
        ) : null
      }
      textStyle={{
        fontSize: 14,
        fontWeight: active ? "600" : "500",
        ...(active ? {} : { color: t.ink }),
      }}
      style={{
        flexBasis: full || oneCol ? "100%" : "47%",
        flexGrow: 1,
        minHeight: 44,
        borderRadius: t.radius.input,
        paddingHorizontal: 12,
        ...(!active && idleBg ? { backgroundColor: idleBg } : {}),
      }}
    />
  );
}

/** Ячейка фасета (Метка/Теги/Команда) — тот же грид-диалект, но
 *  тинт/бордер/галка СВОЕГО цвета сущности + ведущая цветная точка. */
function FacetCell({
  option,
  on,
  idleBg,
  onToggle,
  t,
}: {
  option: FacetOption;
  on: boolean;
  idleBg?: string;
  onToggle: () => void;
  t: ThemeColors;
}) {
  const { fontScale } = useWindowDimensions();
  const oneCol = fontScale >= 1.2;
  const hue = option.color || t.accent;
  const fg = on ? readableColorOnTint(hue, t.surface, t.ink, 0x1f / 255) : t.ink;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={option.label}
      className="flex-row items-center justify-center border px-3 active:opacity-70"
      style={{
        flexBasis: oneCol ? "100%" : "47%",
        flexGrow: 1,
        minHeight: 44,
        gap: 6,
        borderRadius: t.radius.input,
        borderColor: on ? hue : "transparent",
        backgroundColor: on ? `${hue}1F` : (idleBg ?? t.fill),
      }}
    >
      {option.color ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: option.color,
          }}
        />
      ) : null}
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        className="text-sm"
        style={{ color: fg, fontWeight: on ? "600" : "500", flexShrink: 1 }}
      >
        {option.label}
      </Text>
      {/* Слот галки зарезервирован всегда — подпись не прыгает при тапе. */}
      <View style={{ width: 14 }}>
        {on ? <Check color={fg} size={14} strokeWidth={2.6} /> : null}
      </View>
    </Pressable>
  );
}

/** Сетка фасета: 2 колонки, нечётный хвост держит фантом (не тянется),
 *  больше 6 значений — сворачивается в «Ещё N» (выбранные из хвоста
 *  остаются видимыми). «Ещё N» — полуячейка В ПОТОКЕ грида. */
const FACET_VISIBLE_LIMIT = 6;

function FacetGrid({
  options,
  selected,
  idleBg,
  onToggle,
  t,
}: {
  options: FacetOption[];
  selected: string[];
  idleBg?: string;
  onToggle: (value: string) => void;
  t: ThemeColors;
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
        <FacetCell
          key={o.value}
          option={o}
          on={selected.includes(o.value)}
          idleBg={idleBg}
          onToggle={() => onToggle(o.value)}
          t={t}
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
            borderRadius: t.radius.input,
            backgroundColor: idleBg ?? t.fill,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-sm font-semibold"
            style={{ color: t.sub }}
          >
            {expanded ? "Свернуть" : `Ещё ${hiddenCount}`}
          </Text>
        </Pressable>
      ) : null}
      {/* Нечётный хвост НЕ тянется «на всю пространство» (вкус владельца,
          мокап v2): фантомная полуячейка держит его на половине ширины. */}
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
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: ClientsFilter;
  result: ClientFilterResult;
  segmentCounts: SegmentCounts;
  onChange: (f: ClientsFilter) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const presets = useMemo(buildPeriodPresets, [visible]);

  // Аккордеон: открыт максимум один лоток; колесо дат — вложенное
  // состояние лотка Периода.
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  // Какой край диапазона крутит единственное колесо (диалект Финансов).
  const [side, setSide] = useState<"from" | "to">("from");

  // Свежее открытие листа — всё свёрнуто.
  useEffect(() => {
    if (!visible) {
      setOpenSection(null);
      setCustomOpen(false);
      setSide("from");
    }
  }, [visible]);

  // Свернуть колесо, когда период снят снаружи (Сбросить / ✕ токена).
  useEffect(() => {
    if (filter.period === null) {
      setCustomOpen(false);
      setSide("from");
    }
  }, [filter.period]);

  const { filtered, teamOptions, cityOptions, tagOptions } = result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;
  const showLabel =
    shownCount === 0
      ? "Ничего не найдено"
      : `Показать ${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;

  // Live-apply без кнопки Apply нем для VoiceOver: единственный отклик —
  // число в футере. Дебаунс-анонс схлопывает серию тапов в один.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(
      () => AccessibilityInfo.announceForAccessibility(showLabel),
      500,
    );
    return () => clearTimeout(id);
  }, [visible, shownCount, showLabel]);

  // Ядро-«дела» (Должники · Без записи · Напомнить) стоит на постоянных
  // местах ВСЕГДА — мышечная память; при нуле ячейка пригашена и
  // неактивна. Редкие статусы появляются только при наличии клиентов
  // (счётчик — ТОЛЬКО гейт видимости, число не показывается).
  const availableSegments = SEGMENT_OPTIONS.filter(
    (s) =>
      CORE_SEGMENTS.has(s.key) ||
      segmentCounts[s.key] > 0 ||
      filter.segments.includes(s.key),
  );

  const isAll = filter.period === null;
  const isCustom = filter.period?.preset === "custom";

  // Сид колеса: «с начала месяца — по сегодня» — типовой кастом
  // закрывается одним колесом.
  const now = new Date();
  const draftFrom =
    filter.period?.from ??
    formatYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  const draftTo = filter.period?.to ?? formatYMD(now);

  // ── Значения в правой части рядов («статус показан справа») ──────
  const summarize = (names: string[]) =>
    names.length === 0
      ? "Все"
      : names.length === 1
        ? names[0]
        : `${names[0]} +${names.length - 1}`;

  const periodValue = filter.period
    ? isCustom
      ? `${formatShortDateRu(draftFrom)} – ${formatShortDateRu(draftTo)}`
      : (presets.find((p) => p.key === filter.period?.preset)?.label ??
        "Период")
    : "Всё время";
  const statusValue = summarize(
    filter.segments.map(
      (k) => SEGMENT_OPTIONS.find((o) => o.key === k)?.label ?? k,
    ),
  );
  const cityValue = summarize(filter.selectedCities);
  const tagLabel = new Map(tagOptions.map((o) => [o.value, o.label]));
  const tagsValue = summarize(
    filter.activeTags.map((id) => tagLabel.get(id) ?? "").filter(Boolean),
  );
  const teamLabel = new Map(teamOptions.map((o) => [o.value, o.label]));
  const teamValue = summarize(
    filter.selectedTeams.map((id) => teamLabel.get(id) ?? "").filter(Boolean),
  );

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const toggleSection = (k: SectionKey) => {
    const next = openSection === k ? null : k;
    setOpenSection(next);
    if (next !== "period") setCustomOpen(false);
  };

  const setCustomRange = (from: string, to: string) => {
    const [f, tt] = from <= to ? [from, to] : [to, from];
    onChange({ ...filter, period: { preset: "custom", from: f, to: tt } });
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
          borderRadius: t.radius.input - 4,
          backgroundColor: active ? t.surface : "transparent",
        }}
      >
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: active ? t.accent : t.faint }}
        >
          {label}
        </Text>
        <Text
          className="text-[15px] font-semibold"
          style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
        >
          {formatShortDateRu(value)}
        </Text>
      </Pressable>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Шапка 92│центр│92 — «Фильтры» оптически по центру в ЛЮБОМ
          состоянии (боковые слоты держат ширину, даже когда «Сбросить»
          погашен). */}
      <View className="flex-row items-center px-5 pb-2 pt-2">
        <View style={{ width: SLOT }} />
        <View className="flex-1 items-center">
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            className="text-[17px] font-semibold"
            style={{ color: t.ink }}
          >
            Фильтры
          </Text>
        </View>
        <View style={{ width: SLOT, alignItems: "flex-end" }}>
          <Pressable
            onPress={() => {
              if (nothingActive) return;
              haptics.tap();
              onChange(resetFilters());
            }}
            disabled={nothingActive}
            accessibilityRole="button"
            accessibilityLabel="Сбросить фильтры"
            accessibilityState={{ disabled: nothingActive }}
            hitSlop={8}
            className="min-h-11 justify-center active:opacity-60"
          >
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              className="text-[15px] font-semibold"
              style={{ color: nothingActive ? t.faint : t.accent }}
            >
              Сбросить
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Тело — flexShrink, чтобы держаться в потолке листа и скроллиться.
          Боковые отступы ТОЛЬКО через contentContainerStyle: className на
          ScrollView NativeWind молча роняет — контент прилипал к краям. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingVertical: 16,
          paddingHorizontal: 20,
          gap: 8,
        }}
      >
        {/* ── Период ── */}
        <View className="gap-2">
          <FilterRow
            icon={<Calendar color={t.sub} size={16} strokeWidth={2} />}
            title="Период"
            value={periodValue}
            active={!isAll}
            open={openSection === "period"}
            onPress={() => toggleSection("period")}
            t={t}
          />
          {openSection === "period" ? (
            <Tray reduced={reduced} t={t}>
              <View className="flex-row flex-wrap gap-2">
                <GridPill
                  label="Всё время"
                  active={isAll}
                  radio
                  idleBg={t.surface}
                  onPress={() => {
                    setCustomOpen(false);
                    onChange({ ...filter, period: null });
                    setOpenSection(null);
                  }}
                />
                {/* Фантом: «Всё время» — вне пар, дальше ряд = пара
                    «текущий/прошлый» (набор Финансов один в один). */}
                <View style={{ flexBasis: "47%", flexGrow: 1 }} />
                {presets.map((p) => (
                  <GridPill
                    key={p.key}
                    label={p.label}
                    active={!isCustom && filter.period?.preset === p.key}
                    radio
                    idleBg={t.surface}
                    onPress={() => {
                      setCustomOpen(false);
                      onChange({
                        ...filter,
                        period: { preset: p.key, from: p.from, to: p.to },
                      });
                      setOpenSection(null);
                    }}
                  />
                ))}
                <GridPill
                  label={
                    isCustom
                      ? `${formatShortDateRu(draftFrom)} – ${formatShortDateRu(draftTo)}`
                      : "Свой диапазон"
                  }
                  active={isCustom}
                  full
                  radio
                  idleBg={t.surface}
                  onPress={() => setCustomOpen(!customOpen)}
                />
              </View>
              {customOpen ? (
                <View className="mt-2">
                  {/* С | До — сегмент выбирает край, одно колесо крутит
                      (диалект «Свой период» Финансов). Применяется вживую. */}
                  <View
                    className="mb-2 flex-row p-1"
                    style={{
                      borderRadius: t.radius.input,
                      backgroundColor: t.fill,
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
                        if (side === "from")
                          setCustomRange(formatYMD(d), draftTo);
                        else setCustomRange(draftFrom, formatYMD(d));
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </Tray>
          ) : null}
        </View>

        {/* ── Статус ── */}
        <View className="gap-2">
          <FilterRow
            icon={<Sparkles color={t.sub} size={16} strokeWidth={2} />}
            title="Статус"
            value={statusValue}
            active={filter.segments.length > 0}
            open={openSection === "status"}
            onPress={() => toggleSection("status")}
            t={t}
          />
          {openSection === "status" ? (
            <Tray reduced={reduced} t={t}>
              <View className="flex-row flex-wrap gap-2">
                {availableSegments.map((s) => {
                  // Мультивыбор (ИЛИ — объединение, «список на обзвон»).
                  const on = filter.segments.includes(s.key);
                  const dead =
                    CORE_SEGMENTS.has(s.key) &&
                    segmentCounts[s.key] === 0 &&
                    !on;
                  return (
                    <GridPill
                      key={s.key}
                      label={s.label}
                      active={on}
                      checkbox
                      disabled={dead}
                      idleBg={t.surface}
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
            </Tray>
          ) : null}
        </View>

        {/* ── Метка · Теги · Команда: вся библиотека сразу (решение
            владельца), OR-внутри. «Команда» видна всегда. ── */}
        {cityOptions.length > 0 ? (
          <View className="gap-2">
            <FilterRow
              icon={<MapPin color={t.sub} size={16} strokeWidth={2} />}
              title="Метка"
              value={cityValue}
              active={filter.selectedCities.length > 0}
              open={openSection === "city"}
              onPress={() => toggleSection("city")}
              t={t}
            />
            {openSection === "city" ? (
              <Tray reduced={reduced} t={t}>
                <FacetGrid
                  options={cityOptions}
                  selected={filter.selectedCities}
                  idleBg={t.surface}
                  onToggle={(v) =>
                    onChange({
                      ...filter,
                      selectedCities: toggleIn(filter.selectedCities, v),
                    })
                  }
                  t={t}
                />
              </Tray>
            ) : null}
          </View>
        ) : null}

        {tagOptions.length > 0 ? (
          <View className="gap-2">
            <FilterRow
              icon={<Tag color={t.sub} size={16} strokeWidth={2} />}
              title="Теги"
              value={tagsValue}
              active={filter.activeTags.length > 0}
              open={openSection === "tags"}
              onPress={() => toggleSection("tags")}
              t={t}
            />
            {openSection === "tags" ? (
              <Tray reduced={reduced} t={t}>
                <FacetGrid
                  options={tagOptions}
                  selected={filter.activeTags}
                  idleBg={t.surface}
                  onToggle={(v) =>
                    onChange({
                      ...filter,
                      activeTags: toggleIn(filter.activeTags, v),
                    })
                  }
                  t={t}
                />
              </Tray>
            ) : null}
          </View>
        ) : null}

        {teamOptions.length > 0 ? (
          <View className="gap-2">
            <FilterRow
              icon={<Users color={t.sub} size={16} strokeWidth={2} />}
              title="Команда"
              value={teamValue}
              active={filter.selectedTeams.length > 0}
              open={openSection === "team"}
              onPress={() => toggleSection("team")}
              t={t}
            />
            {openSection === "team" ? (
              <Tray reduced={reduced} t={t}>
                <FacetGrid
                  options={teamOptions}
                  selected={filter.selectedTeams}
                  idleBg={t.surface}
                  onToggle={(v) =>
                    onChange({
                      ...filter,
                      selectedTeams: toggleIn(filter.selectedTeams, v),
                    })
                  }
                  t={t}
                />
              </Tray>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Футер: «Показать N» (live) — просто закрывает. При 0 совпадений
          заливка гаснет (цвет=действие не зовёт тапать) + подсказка.
          Нижний отступ — от safe-area (P1-17), а не жёсткие 32pt. */}
      <View
        className="px-5 pt-3"
        style={{
          borderTopWidth: 1,
          borderTopColor: t.separator,
          paddingBottom: Math.max(insets.bottom, 16) + 8,
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
          accessibilityLabel={showLabel}
          className="min-h-[52px] items-center justify-center active:opacity-85"
          style={{
            borderRadius: t.radius.input,
            backgroundColor: shownCount === 0 ? t.fill : t.accent,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-[17px] font-semibold"
            style={{ color: shownCount === 0 ? t.sub : t.onAccent }}
          >
            {showLabel}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
