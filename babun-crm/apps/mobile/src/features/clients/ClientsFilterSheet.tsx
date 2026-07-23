import { useEffect, useMemo, useRef, useState } from "react";
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
import { Check } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import {
  DetentSheet,
  type Detent,
  type DetentSheetHandle,
} from "@/components/ui/DetentSheet";
import { Chip } from "@/components/ui/Chip";
import { readableColorOnTint } from "@/components/ui/color-contrast";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { parseYMD, formatYMD } from "@/features/appointments/helpers";
import { formatShortDateRu } from "./format";
import {
  buildPeriodPresets,
  CORE_SEGMENTS,
  filterActiveCount,
  resetFilters,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type SegmentCounts,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Лист «Фильтры» — ФИНАЛ «Тихого листа» (решение руководителя по
// исследованию Airbnb/Apple/SaaS-CRM + адверсариальной критике,
// 2026-07-23). Немодальный DetentSheet: открывается на ПОЛОВИНУ экрана
// БЕЗ скрима — список клиентов позади остаётся живым и перестраивается
// на каждый тап (live-apply как наблюдаемая правда, диалект Apple Maps);
// дотягивание до 92% добавляет скрим. ВСЁ ВИДНО СРАЗУ, ноль аккордеонов
// и скрытых уровней — один прокручиваемый стек секций:
//   Статус (ежедневное ядро — первым, в зоне большого пальца) ·
//   Период (пары «текущий | прошлый» тем же гридом; «Свой диапазон»
//   раскрывает С|До + колесо и поднимает лист) · Метка · Теги · Команда.
// Заголовки секций — капс 12/700 sub (двухосевое отличие от ячеек,
// иконки не нужны). Ячейки — симметричный 2-кол грид 44pt, тинт 12%
// своего цвета; ядро-статусы всегда на местах (пустые пригашены).
// «Сбросить» с прощением: 4 секунды показывает «Вернуть». CTA прижат к
// низу ЭКРАНА (виден на любом детенте): «Готово · N» на половине /
// «Показать N» на 92%. Счётчиков на контролах нет — число живёт только
// в CTA и баре. Всё применяется LIVE.

const SLOT = 92; // боковые слоты шапки: заголовок оптически по центру,
// «Сбросить»/«Вернуть» (15/600) без клипа.

// ── Строительные блоки ─────────────────────────────────────────────

/** Заголовок секции: капс 12/700 sub — отличие от ячеек по двум осям
 *  (регистр+размер), сканируется без иконок («типографика без фигур»). */
function SectionTitle({ children, t }: { children: string; t: ThemeColors }) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.3}
      className="text-xs font-bold uppercase"
      style={{ color: t.sub, letterSpacing: 0.5 }}
    >
      {children}
    </Text>
  );
}

/** Ячейка 2-кол грида (Статус/Период) — БЕЗ числа: только подпись (+
 *  галка у мультивыбора; radio-группам хватает тинта+бордера — P1-6).
 *  Слот галки зарезервирован ВСЕГДА — подпись не прыгает. При крупном
 *  Dynamic Type (fontScale ≥ 1.2) грид складывается в одну колонку. */
function GridPill({
  label,
  active,
  full,
  radio,
  checkbox,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  /** Полноширинная («Всё время» / «Свой диапазон»). */
  full?: boolean;
  /** Одиночный выбор (пресеты) — VoiceOver «1 из N». */
  radio?: boolean;
  /** Мультивыбор (Статус) — VoiceOver «отмечено». */
  checkbox?: boolean;
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
      }}
    />
  );
}

/** Ячейка фасета (Метка/Теги/Команда) — тот же грид-диалект, но
 *  тинт/бордер/галка СВОЕГО цвета сущности + ведущая цветная точка. */
function FacetCell({
  option,
  on,
  onToggle,
  t,
}: {
  option: FacetOption;
  on: boolean;
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
        backgroundColor: on ? `${hue}1F` : t.fill,
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
  onToggle,
  t,
}: {
  options: FacetOption[];
  selected: string[];
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
            backgroundColor: t.fill,
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
      {/* Нечётный хвост НЕ тянется «на всю пространство» (вкус владельца):
          фантомная полуячейка держит его на половине ширины. */}
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

  const sheetRef = useRef<DetentSheetHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [detent, setDetent] = useState<Detent>("medium");

  const [customOpen, setCustomOpen] = useState(false);
  // Какой край диапазона крутит единственное колесо (диалект Финансов).
  const [side, setSide] = useState<"from" | "to">("from");
  // Позиция блока колеса в скролле — доскролливаем к нему при раскрытии.
  const customY = useRef(0);

  // «Сбросить» с прощением: 4 секунды можно «Вернуть» снятый набор.
  const [undo, setUndo] = useState<ClientsFilter | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setCustomOpen(false);
      setSide("from");
      setDetent("medium");
      setUndo(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    }
  }, [visible]);

  // Свернуть колесо, когда период снят снаружи (Сбросить / ✕ токена).
  useEffect(() => {
    if (filter.period === null) {
      setCustomOpen(false);
      setSide("from");
    }
  }, [filter.period]);

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

  // Ядро-«дела» стоит на постоянных местах ВСЕГДА (при нуле — пригашено);
  // редкие статусы появляются только при наличии клиентов.
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

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const setCustomRange = (from: string, to: string) => {
    const [f, tt] = from <= to ? [from, to] : [to, from];
    onChange({ ...filter, period: { preset: "custom", from: f, to: tt } });
  };

  const openCustom = () => {
    haptics.tap();
    const next = !customOpen;
    setCustomOpen(next);
    if (next) {
      // Колесо крупное — поднимаем лист и доскролливаем к блоку.
      sheetRef.current?.expand();
      setDetent("large");
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({
            y: Math.max(0, customY.current - 72),
            animated: !reduced,
          }),
        120,
      );
    }
  };

  const onReset = () => {
    haptics.tap();
    if (undo) {
      // «Вернуть»: восстанавливаем снятый набор.
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
        className="min-h-[52px] items-center justify-center active:opacity-85"
        style={{
          borderRadius: t.radius.input,
          backgroundColor: shownCount === 0 ? t.fill : t.accent,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          className="text-[17px] font-semibold"
          style={{
            color: shownCount === 0 ? t.sub : t.onAccent,
            fontVariant: ["tabular-nums"],
          }}
        >
          {ctaLabel}
        </Text>
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
            style={{ color: t.ink }}
          >
            Фильтры
          </Text>
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

      {/* Один стек — всё видно сразу, ноль скрытых уровней. Скролл живёт
          на ЛЮБОМ детенте — Метка/Теги/Команда достижимы прямо с
          полулиста; высоту меняет только язычок. Паддинги ТОЛЬКО через
          contentContainerStyle (NativeWind молча роняет className). */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 10,
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 28,
        }}
      >
        {/* ── Статус: ежедневное ядро — первым, в зоне большого пальца ── */}
        <View className="gap-2">
          <SectionTitle t={t}>Статус</SectionTitle>
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

        {/* ── Период: пары «текущий | прошлый» (набор Финансов 1:1) ── */}
        <View className="gap-2">
          <SectionTitle t={t}>Период</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            <GridPill
              label="Всё время"
              active={isAll}
              full
              radio
              onPress={() => {
                setCustomOpen(false);
                onChange({ ...filter, period: null });
              }}
            />
            {presets.map((p) => (
              <GridPill
                key={p.key}
                label={p.label}
                active={!isCustom && filter.period?.preset === p.key}
                radio
                onPress={() => {
                  setCustomOpen(false);
                  onChange({
                    ...filter,
                    period: { preset: p.key, from: p.from, to: p.to },
                  });
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
              onPress={openCustom}
            />
          </View>

          {customOpen ? (
            <Animated.View
              entering={reduced ? undefined : FadeInDown.duration(180)}
              exiting={reduced ? undefined : FadeOut.duration(120)}
              onLayout={(e) => {
                customY.current = e.nativeEvent.layout.y;
              }}
              className="p-3"
              style={{ borderRadius: t.radius.card, backgroundColor: t.canvas }}
            >
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
                    if (side === "from") setCustomRange(formatYMD(d), draftTo);
                    else setCustomRange(draftFrom, formatYMD(d));
                  }}
                />
              </View>
            </Animated.View>
          ) : null}
        </View>

        {/* ── Метка · Теги · Команда: вся библиотека сразу, OR-внутри ── */}
        {cityOptions.length > 0 ? (
          <View className="gap-2">
            <SectionTitle t={t}>Метка</SectionTitle>
            <FacetGrid
              options={cityOptions}
              selected={filter.selectedCities}
              onToggle={(v) =>
                onChange({
                  ...filter,
                  selectedCities: toggleIn(filter.selectedCities, v),
                })
              }
              t={t}
            />
          </View>
        ) : null}

        {tagOptions.length > 0 ? (
          <View className="gap-2">
            <SectionTitle t={t}>Теги</SectionTitle>
            <FacetGrid
              options={tagOptions}
              selected={filter.activeTags}
              onToggle={(v) =>
                onChange({
                  ...filter,
                  activeTags: toggleIn(filter.activeTags, v),
                })
              }
              t={t}
            />
          </View>
        ) : null}

        {teamOptions.length > 0 ? (
          <View className="gap-2">
            <SectionTitle t={t}>Команда</SectionTitle>
            <FacetGrid
              options={teamOptions}
              selected={filter.selectedTeams}
              onToggle={(v) =>
                onChange({
                  ...filter,
                  selectedTeams: toggleIn(filter.selectedTeams, v),
                })
              }
              t={t}
            />
          </View>
        ) : null}
      </ScrollView>
    </DetentSheet>
  );
}
