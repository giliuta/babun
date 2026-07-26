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
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import type {
  AcquisitionSource,
  PropertyType,
} from "@babun/shared/local/clients";
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
  PROPERTY_OPTIONS,
  propertyTypeLabel,
  resetFilters,
  SEGMENT_BLOCKS,
  SEGMENT_OPTIONS,
  FACET_SUBTITLES,
  SORT_BLOCKS,
  SORT_LABELS_LONG,
  SOURCE_OPTIONS,
  type ClientsFilter,
  type FacetOption,
  type SegmentKey,
  type SortKey,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";
import { useReduceMotion } from "@/lib/reduce-motion";

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
const GRABBER_H = 19; // язычок листа (высота + его отступы)
const TOP_GAP = 10; // зазор до статус-бара

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
  hint,
  onPress,
}: {
  name: string;
  value: { label: string; extra: number } | null;
  /** Цвет тика сущности (метка/тег/команда) — только при выборе. */
  tick?: string;
  /** VoiceOver-хинт: у одиночного и мультивыбора он разный. */
  hint?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={name}
      // Значение — в accessibilityValue: VoiceOver читает «Статус, Должники
      // и ещё 2», а не склеенную строку с плюсом.
      accessibilityValue={{
        text: value
          ? value.extra > 0
            ? `${value.label} и ещё ${value.extra}`
            : value.label
          : "Все",
      }}
      accessibilityHint={hint ?? "Открывает выбор"}
      // Раскладка ТОЛЬКО в style: NativeWind v5 роняет style-функцию
      // Pressable, если рядом есть className. Нажатие углубляет материал,
      // а не гасит прозрачностью.
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontSize: 15,
          fontWeight: "600",
          color: t.ink,
          marginRight: 4,
        }}
      >
        {name}
      </Text>
      <ChevronDown color={t.chevron} size={14} strokeWidth={2.6} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginLeft: "auto",
          paddingLeft: 10,
          flexShrink: 1,
          minWidth: 56,
          justifyContent: "flex-end",
        }}
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
        {/* Вес значения постоянный — при выборе меняется только цвет,
            иначе строка «дёргалась» с 500 на 700. */}
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 15,
            fontWeight: "700",
            color: value ? t.ink : t.faint,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value ? value.label : "Все"}
        </Text>
        {/* «+K» — отдельный несжимаемый Text: обрезаться должно длинное
            имя, а не счётчик остальных. */}
        {value && value.extra > 0 ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              flexShrink: 0,
              fontSize: 15,
              fontWeight: "700",
              color: t.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {` +${value.extra}`}
          </Text>
        ) : null}
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
  reduced,
  onToggle,
}: {
  label: string;
  active: boolean;
  /** Волосок к соседу сверху (внутри блока). */
  separated: boolean;
  tick?: string;
  count: number;
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
    // В мёртвом ряду ноль не должен звучать громче имени.
    color: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.28)" : t.faint, "rgba(255,255,255,0.64)"],
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
          ? `${label}, нет клиентов при текущих условиях`
          : `${label}, ${count} ${countWordRu(count, "клиент", "клиента", "клиентов")}`
      }
      accessibilityHint={
        dimmed ? undefined : "Добавляет к набору, список останется открытым"
      }
      // 0.70 сереет чернила оттиска — берём мягче.
      className="flex-row items-center active:opacity-90"
      style={[
        {
          minHeight: 48,
          paddingHorizontal: 16,
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
      {/* Вес подписи постоянный: на тапе менялся 500→600 и строка
          внезапно обзаводилась многоточием. */}
      <Animated.Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={[
          { flexShrink: 1, fontSize: 15, fontWeight: "600" },
          labelStyle,
        ]}
      >
        {label}
      </Animated.Text>
      <Animated.Text
        maxFontSizeMultiplier={1.3}
        style={[
          {
            marginLeft: "auto",
            paddingLeft: 12,
            fontSize: 13,
            fontVariant: ["tabular-nums"],
          },
          hintStyle,
        ]}
      >
        {count}
      </Animated.Text>
    </AnimatedPressable>
  );
}

/** Футер-CTA — общий каркас страницы и попапов. Глагол статичен, катается
 *  ТОЛЬКО меняющаяся часть (число): раньше при каждом пересчёте
 *  перерисовывалась вся надпись, и кнопка «моргала» глаголом. Слот хинта
 *  постоянной высоты — иначе лист прыгал на 26pt прямо под пальцем. */
function FooterCta({
  t,
  verb,
  roll,
  hint,
  a11yLabel,
  a11yHint,
  reduced,
  onPress,
}: {
  t: ThemeColors;
  /** Статичная часть надписи («Показать », «Готово · »). */
  verb: string;
  /** Меняющаяся часть («12 клиентов») — она и катается. */
  roll?: string | null;
  /** Строка над кнопкой; null держит место, не показывая текста. */
  hint?: string | null;
  a11yLabel: string;
  a11yHint: string;
  reduced: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Первый кадр не анимируем: иначе счётчик «влетал» при каждом открытии.
  const firstFrame = useRef(true);
  useEffect(() => {
    firstFrame.current = false;
  }, []);
  const animate = !reduced && !firstFrame.current;
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
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        accessibilityElementsHidden={!hint}
        style={{
          marginBottom: 8,
          minHeight: 16,
          textAlign: "center",
          fontSize: 13,
          color: t.faint,
          opacity: hint ? 1 : 0,
        }}
      >
        {hint ?? " "}
      </Text>
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={a11yHint}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 52,
          borderRadius: 14,
          overflow: "hidden",
          backgroundColor: t.accent,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 17, fontWeight: "600", color: t.onAccent }}
        >
          {verb}
        </Text>
        {roll ? (
          <Animated.Text
            key={roll}
            entering={animate ? FadeInUp.duration(160) : undefined}
            exiting={animate ? FadeOutDown.duration(120) : undefined}
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: t.onAccent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {roll}
          </Animated.Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Попап мультивыбора — общая грамматика блоков: контейнеры попапа
 *  периода (блоки canvas без подписей, ряды 48), отметка = оттиск.
 *  Live-apply, тап НЕ закрывает — накликивается набор. «Готово · N»
 *  (и скрим/свайп) возвращают на СТРАНИЦУ фильтров, где выбранное
 *  видно в строке; на список ведёт только CTA страницы (решение
 *  владельца 2026-07-24: тап не должен «перекидывать в клиенты»). */
function MultiPickSheet({
  visible,
  title,
  subtitle,
  blocks,
  selected,
  counts,
  shownCount,
  zeroHint,
  reduced,
  onToggle,
  onClear,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Подпись-семантика под заголовком — своя у каждого фасета. */
  subtitle: string;
  blocks: FacetOption[][];
  selected: string[];
  counts: Record<string, number>;
  shownCount: number;
  /** Объяснение нуля («Без «Команда» — 12 клиентов»). */
  zeroHint: string | null;
  reduced: boolean;
  onToggle: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  // Снимок счётчиков на время жизни попапа: фоновый синк не должен гасить
  // ряд под пальцем, пока владелец собирает набор.
  const frozen = useRef(counts);
  if (!visible) frozen.current = counts;
  const shown = visible ? frozen.current : counts;
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const alive = blocks.some((b) =>
    b.some((o) => (shown[o.value] ?? 0) > 0 || selected.includes(o.value)),
  );
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.85}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 12,
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
          >
            {title}
          </Text>
          {/* Семантика набора словами — своя формулировка на фасет. */}
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ marginTop: 2, fontSize: 13, color: t.faint }}
          >
            {subtitle}
          </Text>
        </View>
        {selected.length > 0 ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClear();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Снять всё в «${title}»`}
            hitSlop={10}
            style={{ minHeight: 32, justifyContent: "center" }}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
            >
              Снять всё
            </Text>
          </Pressable>
        ) : null}
      </View>
      {alive || total === 0 ? (
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        >
          {blocks.map((block, bi) =>
            block.length === 0 ? null : (
              // Материал несёт сам ряд (канон «Оттиск») — блок прозрачный.
              <View
                key={bi}
                style={{
                  marginBottom: 8,
                  borderRadius: 12,
                  overflow: "hidden",
                  backgroundColor: t.rowFill,
                }}
              >
                {block.map((o, i) => (
                  <PickRow
                    key={o.value}
                    label={o.label}
                    active={selected.includes(o.value)}
                    separated={i > 0}
                    tick={o.color || undefined}
                    count={shown[o.value] ?? 0}
                    reduced={reduced}
                    onToggle={() => onToggle(o.value)}
                  />
                ))}
              </View>
            ),
          )}
        </ScrollView>
      ) : (
        // Тупик (все ряды нулевые) — штатная ситуация при выбранной
        // команде. Поле мёртвых рядов не объясняет ничего; текст — да.
        <View style={{ paddingHorizontal: 20, paddingVertical: 22 }}>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            При текущих условиях вариантов нет
          </Text>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ marginTop: 4, fontSize: 13, color: t.faint, lineHeight: 18 }}
          >
            Снимите другие условия — и значения появятся.
          </Text>
        </View>
      )}
      <FooterCta
        t={t}
        verb="Готово"
        roll={
          shownCount === 0
            ? null
            : ` · ${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`
        }
        hint={zeroHint}
        a11yLabel={
          shownCount === 0
            ? "Готово"
            : `Готово, ${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`
        }
        a11yHint="Возвращает к фильтрам"
        reduced={reduced}
        onPress={onClose}
      />
    </BottomSheet>
  );
}

/** Попап одиночного выбора — закон «галка = один»: тап применяет и
 *  ЗАКРЫВАЕТ (эталон — пресеты периода). Для «Сортировки»: это
 *  персистентная настройка списка, «Сбросить» её не трогает. */
function SinglePickSheet({
  visible,
  title,
  subtitle,
  blocks,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  /** Смысловые группы рядов — блоки разделены воздухом, как у периода. */
  blocks: { value: string; label: string }[][];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.85}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ marginTop: 2, fontSize: 13, color: t.faint }}
        >
          {subtitle}
        </Text>
      </View>
      {/* Скролл обязателен: при крупном шрифте нижние оси иначе
          недостижимы — до них просто не дотянуться. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 16) + 12,
        }}
      >
        {blocks.map((block, bi) =>
          block.length === 0 ? null : (
            <View
              key={bi}
              accessibilityRole="radiogroup"
              style={{
                marginBottom: 8,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: t.rowFill,
              }}
            >
              {block.map((o, i) => {
                const on = selected === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      haptics.tap();
                      if (!on) onSelect(o.value);
                      onClose();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={o.label}
                    accessibilityHint="Применяет и закрывает"
                    // Раскладка ТОЛЬКО через style: NativeWind v5 роняет
                    // style-функцию Pressable, если рядом есть className
                    // (тот же баг, что с паддингами на ScrollView).
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 16,
                      minHeight: 48,
                      borderTopWidth: i > 0 ? 1 : 0,
                      borderTopColor: t.separator,
                      backgroundColor: pressed
                        ? t.rowFillPressed
                        : "transparent",
                    })}
                  >
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        fontSize: 15,
                        fontWeight: "600",
                        color: on ? t.accent : t.ink,
                      }}
                    >
                      {o.label}
                    </Text>
                    {on ? (
                      <View style={{ marginLeft: "auto", paddingLeft: 8 }}>
                        <Check color={t.accent} size={18} strokeWidth={2.6} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ),
        )}
      </ScrollView>
    </BottomSheet>
  );
}

// ── Панель ─────────────────────────────────────────────────────────

type FacetSheet = "segment" | "city" | "tag" | "team" | "source" | "property";

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
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { height: winH } = useWindowDimensions();

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [openFacet, setOpenFacet] = useState<FacetSheet | null>(null);

  // «Сбросить» с прощением: снятый набор (вместе с запросом поиска) можно
  // вернуть, пока лист открыт и пока набор не тронут заново. Таймера НЕТ:
  // немой обрыв через N секунд — худший вариант, особенно для VoiceOver.
  const [undo, setUndo] = useState<{
    filter: ClientsFilter;
    search: string;
  } | null>(null);

  // Попап под токеном открываем ЧЕРЕЗ КАДР после входной пружины листа —
  // иначе две пружины стартуют одновременно и обе смазываются.
  useEffect(() => {
    if (!visible || !initialFacet) return;
    const id = setTimeout(() => setOpenFacet(initialFacet), 260);
    return () => clearTimeout(id);
  }, [visible, initialFacet]);

  useEffect(() => {
    if (!visible) {
      setPresetsOpen(false);
      setWheelsOpen(false);
      setSortOpen(false);
      setOpenFacet(null);
      setUndo(null);
    }
  }, [visible]);

  const {
    filtered,
    teamOptions,
    cityOptions,
    tagOptions,
    facetCounts,
    hasSourceData,
    hasPropertyData,
  } = result;
  const shownCount = filtered.length;
  const trimmedSearch = search.trim();
  // Поиск — часть набора: без этого при активном запросе «Сбросить» была
  // мертва и из «ноль клиентов» не было выхода прямо из листа.
  const nothingActive = filterActiveCount(filter) === 0 && !trimmedSearch;

  // Полная страница: высота окна минус верхний зазор и грабер листа.
  const pageH = winH - insets.top - GRABBER_H - TOP_GAP;

  const countPart = `${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;
  // Винительный падеж: «Показать 1 клиентА» (у «Готово · 1 клиент» —
  // именительный, там число просто называется).
  const countAcc = `${shownCount} ${countWordRu(shownCount, "клиента", "клиента", "клиентов")}`;

  // Кто виноват в нуле: считаем по leave-one-out из того же прохода, что и
  // счётчики. Одна формула на страницу и на попап.
  const zeroHint = (() => {
    if (shownCount > 0) return null;
    const w = facetCounts.withoutOne;
    const names: Record<string, string> = {
      search: "поиск",
      period: "период",
      segment: "статус",
      city: "метку",
      tag: "теги",
      team: "команду",
      source: "источник",
      property: "тип объекта",
    };
    const active: Record<string, boolean> = {
      search: !!trimmedSearch,
      period: !!filter.period,
      segment: filter.segments.length > 0,
      city: filter.selectedCities.length > 0,
      tag: filter.activeTags.length > 0,
      team: filter.selectedTeams.length > 0,
      source: filter.sources.length > 0,
      property: filter.propertyTypes.length > 0,
    };
    let best: { key: string; n: number } | null = null;
    for (const key of Object.keys(names)) {
      if (!active[key]) continue;
      const n = w[key] ?? 0;
      if (n > 0 && (!best || n > best.n)) best = { key, n };
    }
    if (!best) return "Ничего не найдено — снимите условия";
    return `Без «${names[best.key]}» — ${best.n} ${countWordRu(best.n, "клиент", "клиента", "клиентов")}`;
  })();

  // Live-apply нем для VoiceOver — дебаунс-анонс счётчика. На открытии
  // листа не стреляем: там и так читается заголовок.
  const announcedOnce = useRef(false);
  useEffect(() => {
    if (!visible) {
      announcedOnce.current = false;
      return;
    }
    if (!announcedOnce.current) {
      announcedOnce.current = true;
      return;
    }
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
  const searchNote = search.trim() ? `Поиск: «${search.trim()}»` : null;
  const activeSummary = nothingActive && !searchNote
    ? null
    : [
        // Поиск участвует во ВСЕХ числах листа — если он не виден,
        // «Показать 0» выглядит необъяснимым.
        ...(searchNote ? [searchNote] : []),
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
        ...filter.sources
          .map((s) => SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? "")
          .filter(Boolean),
        ...filter.propertyTypes.map(propertyTypeLabel).filter(Boolean),
      ].join(" · ");

  // Сплит периода (диалект Финансов): слева имя, справа всегда даты —
  // у «Всего времени» это честный охват данных «с первой записи по
  // сегодня». Тот же диапазон сидит и в колёсах, и в подсказке попапа.
  const now = new Date();
  const todayYmd = formatYMD(now);
  // Охват данных честен в обе стороны: у тенанта с записями только в
  // будущем «Всё время» — это «сегодня — последняя запись», а не «сегодня».
  const spanFrom = dataFrom && dataFrom < todayYmd ? dataFrom : todayYmd;
  const spanTo = dataTo && dataTo > todayYmd ? dataTo : todayYmd;
  const allSpanDates =
    dataFrom || dataTo
      ? periodDates({ preset: "custom", from: spanFrom, to: spanTo })
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

  // Любая правка фильтра гасит окно «Вернуть»: иначе кнопка залипала и
  // молча выбрасывала только что собранный набор (владелец жал «Вернуть»
  // и терял выбор).
  const applyFilter = (next: ClientsFilter) => {
    if (undo) setUndo(null);
    onChange(next);
  };

  const onReset = () => {
    if (undo) {
      haptics.success();
      onChange(undo.filter);
      onClearSearch(undo.search);
      setUndo(null);
      AccessibilityInfo.announceForAccessibility("Фильтры возвращены");
      return;
    }
    if (nothingActive) return;
    haptics.tap();
    setUndo({ filter, search });
    onChange(resetFilters());
    onClearSearch("");
    AccessibilityInfo.announceForAccessibility(
      "Фильтры сброшены. Кнопка справа вверху вернёт их",
    );
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
      subtitle: string;
      blocks: FacetOption[][];
      selected: string[];
      counts: Record<string, number>;
      toggle: (v: string) => void;
      clear: () => void;
    }
  > = {
    segment: {
      title: "Статус",
      subtitle: FACET_SUBTITLES.segment,
      blocks: segmentBlocks,
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
      blocks: [SOURCE_OPTIONS],
      selected: filter.sources,
      counts: facetCounts.source,
      toggle: (v) =>
        applyFilter({
          ...filter,
          sources: toggleIn(filter.sources, v) as AcquisitionSource[],
        }),
      clear: () => applyFilter({ ...filter, sources: [] }),
    },
    property: {
      title: "Тип объекта",
      subtitle: FACET_SUBTITLES.property,
      blocks: [PROPERTY_OPTIONS],
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

  // Сортировка — всегда одно значение (не «Все»), персистентна; блоки
  // время · деньги · алфавит.
  const sortBlocks = SORT_BLOCKS.map((block) =>
    block.map((k) => ({ value: k as string, label: SORT_LABELS_LONG[k] })),
  );

  // Сводки строк — первый выбранный по каноническому порядку + «+K».
  const segmentValue = summarize(segmentAsOptions, filter.segments);
  const cityValue = summarize(cityOptions, filter.selectedCities);
  const tagValue = summarize(tagOptions, filter.activeTags);
  const teamValue = summarize(teamOptions, filter.selectedTeams);
  const sourceValue = summarize(SOURCE_OPTIONS, filter.sources);
  const propertyValue = summarize(PROPERTY_OPTIONS, filter.propertyTypes);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={1}>
      <View style={{ height: pageH }}>
        {/* Шапка 92│центр│92 — «Фильтры» оптически по центру всегда. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 44,
            paddingHorizontal: 20,
            paddingTop: 6,
          }}
        >
          <View style={{ width: SLOT }} />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
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
              hitSlop={12}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  // Выключенная кнопка должна быть ТИШЕ живой: t.faint
                  // темнее кобальта и читался как активный.
                  color:
                    nothingActive && !undo ? "rgba(11,18,32,0.28)" : t.accent,
                }}
              >
                {undo ? "Вернуть" : "Сбросить"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Сводка — во всю ширину под шапкой, а не в узкой центральной
            колонке (178 → 362pt): туда помещается реальный набор. */}
        {activeSummary || undo ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={2}
            style={{
              paddingHorizontal: 20,
              marginTop: 3,
              fontSize: 12,
              fontWeight: "500",
              textAlign: "center",
              color: t.faint,
            }}
          >
            {undo ? "Сброшено" : activeSummary}
          </Text>
        ) : null}

        {/* Страница-бланк: абзацы строк (12 внутри, 28 между),
            прижаты к шапке, ниже — намеренная пустота до футера.
            Паддинги ТОЛЬКО через contentContainerStyle (NativeWind
            роняет className на ScrollView). */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 24,
            paddingHorizontal: 20,
            paddingBottom: 28,
            gap: 28,
          }}
        >
          {/* ── Как показывать: сортировка отдельным абзацем — это НЕ
              фильтр (персистентна, «Сбросить» её не трогает). ── */}
          <FilterRow
            name="Сортировка"
            value={{ label: SORT_LABELS_LONG[sort], extra: 0 }}
            onPress={() => setSortOpen(true)}
          />

          {/* ── Абзац «когда и кого» ── */}
          <View style={{ gap: 12 }}>
            {/* Период: сплит Финансов — имя → пресеты, даты → колёса.
                Волосок между половинами: без него правая часть не
                читалась как отдельная кнопка. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "stretch",
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: t.rowFill,
              }}
            >
              <Pressable
                onPress={() => {
                  haptics.tap();
                  setPresetsOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Период: ${periodName}`}
                accessibilityHint="Открывает список периодов"
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: 16,
                  paddingRight: 8,
                  gap: 4,
                  borderTopLeftRadius: 14,
                  borderBottomLeftRadius: 14,
                  backgroundColor: pressed ? t.rowFillPressed : "transparent",
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {periodName}
                </Text>
                <ChevronDown color={t.chevron} size={14} strokeWidth={2.6} />
              </Pressable>
              <View
                style={{
                  width: 1,
                  alignSelf: "center",
                  height: 20,
                  backgroundColor: "rgba(11,18,32,0.10)",
                }}
              />
              <Pressable
                onPress={() => {
                  haptics.tap();
                  setWheelsOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Даты: ${
                  filter.period ? datesLabel : "не заданы"
                }`}
                accessibilityHint="Открывает выбор диапазона"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: 12,
                  paddingRight: 16,
                  borderTopRightRadius: 14,
                  borderBottomRightRadius: 14,
                  backgroundColor: pressed ? t.rowFillPressed : "transparent",
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={{
                    fontSize: 15,
                    // В покое даты не спорят с именем периода.
                    fontWeight: filter.period ? "700" : "500",
                    color: filter.period ? t.ink : t.faint,
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

          {/* ── Абзац «чьих» — обёртка гейтится, иначе пустой абзац
              оставлял дыру в 56pt (gap сверху + снизу). ── */}
          {cityOptions.length > 0 ||
          tagOptions.length > 0 ||
          teamOptions.length > 0 ? (
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
            {teamOptions.length > 0 ? (
              <FilterRow
                name="Команда"
                value={teamValue}
                tick={teamValue?.color}
                onPress={() => setOpenFacet("team")}
              />
            ) : null}
          </View>
          ) : null}

          {/* ── Абзац «портрет»: строки появляются, когда данные есть, но
              УЖЕ ВЫБРАННОЕ держит строку видимой (иначе фильтр не снять). ── */}
          {hasSourceData ||
          hasPropertyData ||
          filter.sources.length > 0 ||
          filter.propertyTypes.length > 0 ? (
            <View style={{ gap: 12 }}>
              {hasSourceData || filter.sources.length > 0 ? (
                <FilterRow
                  name="Источник"
                  value={sourceValue}
                  onPress={() => setOpenFacet("source")}
                />
              ) : null}
              {hasPropertyData || filter.propertyTypes.length > 0 ? (
                <FilterRow
                  name="Тип объекта"
                  value={propertyValue}
                  onPress={() => setOpenFacet("property")}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>

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
            subtitle={cfg.subtitle}
            blocks={cfg.blocks}
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
    </BottomSheet>
  );
}
