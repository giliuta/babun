import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  ArrowUpDown,
  Calendar,
  Check,
  MapPin,
  Sparkles,
  Tag,
  Users,
} from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { parseYMD, formatYMD } from "@/features/appointments/helpers";
import { formatShortDateRu } from "./format";
import {
  buildPeriodPresets,
  filterActiveCount,
  resetFilters,
  SEGMENT_OPTIONS,
  SORT_LABELS,
  SORT_ORDER,
  type ClientsFilter,
  type FacetOption,
  type SegmentCounts,
} from "./filter";
import type { ClientFilterResult } from "./useClientFilters";

// Нижний лист «Фильтры» (BottomSheet) с секциями Порядок / Статус
// (2-col grid) / Команда / Метка / Тег (фасеты построчно) / Период
// (2-col grid + «Свой диапазон» = сегмент «С|До» + одно колесо, диалект
// Финансов). Все контролы применяются LIVE — футер «Показать N» закрывает.

// ── Мелкие строительные блоки ──────────────────────────────────────

/** Ячейка 2-col грида: пилюля с галкой (Порядок / Статус / Период). */
function GridPill({
  label,
  active,
  count,
  full,
  onPress,
}: {
  label: string;
  active: boolean;
  count?: number;
  /** Полноширинная (например «Свой диапазон»). */
  full?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  // v812 grid geometry (h-11 / rounded-xl / 2-col) поверх примитива Chip
  // variant="tint" — цвета/типографика/a11y едины с остальными чипами.
  return (
    <Chip
      label={label}
      count={count}
      variant="tint"
      selected={active}
      onPress={onPress}
      icon={
        active ? <Check color={t.accent} size={14} strokeWidth={2.6} /> : null
      }
      textStyle={active ? undefined : { color: t.ink }}
      style={{
        width: full ? "100%" : "48.3%",
        minHeight: 44,
        borderRadius: t.radius.input,
        paddingHorizontal: 12,
      }}
    />
  );
}

/** Строка фасета: цветная точка + подпись + счётчик + галка. */
function FacetRow({
  option,
  on,
  count,
  onToggle,
  t,
}: {
  option: FacetOption;
  on: boolean;
  count: number;
  onToggle: () => void;
  t: ThemeColors;
}) {
  const dimmed = !on && count === 0;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      disabled={dimmed}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: dimmed }}
      accessibilityLabel={`${option.label}, ${count}`}
      className="h-11 flex-row items-center gap-2.5 border px-3 active:opacity-70"
      style={{
        borderRadius: t.radius.input,
        borderColor: on ? t.accent : "transparent",
        backgroundColor: on ? `${t.accent}14` : t.fill,
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: option.color,
        }}
      />
      <Text
        className="flex-1 text-sm font-medium"
        numberOfLines={1}
        style={{ color: on ? t.accent : t.ink }}
      >
        {option.label}
      </Text>
      <Text
        className="text-xs"
        style={{ color: t.faint, fontVariant: ["tabular-nums"] }}
      >
        {count}
      </Text>
      {on ? <Check color={t.accent} size={16} strokeWidth={2.6} /> : null}
    </Pressable>
  );
}

/** Секция с иконкой-плиткой и капс-заголовком (web Section). */
function Section({
  icon,
  caption,
  children,
}: {
  icon: ReactNode;
  caption: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View
          className="h-6 w-6 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `${t.accent}14`,
          }}
        >
          {icon}
        </View>
        <Text
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: t.faint }}
        >
          {caption}
        </Text>
      </View>
      {children}
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
  const presets = useMemo(buildPeriodPresets, [visible]);
  const scrollRef = useRef<ScrollView>(null);
  const [customOpen, setCustomOpen] = useState(false);
  // Какой край диапазона крутит единственное колесо (диалект Финансов).
  const [side, setSide] = useState<"from" | "to">("from");

  // Свернуть пикеры, когда период снят снаружи (Сбросить / ✕ токена).
  useEffect(() => {
    if (filter.period === null) {
      setCustomOpen(false);
      setSide("from");
    }
  }, [filter.period]);

  const { filtered, facetCounts, teamOptions, cityOptions, tagOptions } =
    result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;
  const showLabel =
    shownCount === 0
      ? "Ничего не найдено"
      : `Показать ${shownCount} ${countWordRu(shownCount, "клиент", "клиента", "клиентов")}`;

  // Пилюля статуса рендерится при совпадениях ИЛИ когда она выбрана —
  // иначе выбранный сегмент с упавшим до 0 счётчиком нельзя снять.
  const availableSegments = SEGMENT_OPTIONS.filter(
    (s) => segmentCounts[s.key] > 0 || filter.segments.includes(s.key),
  );

  const isAll = filter.period === null;
  const isCustom = filter.period?.preset === "custom";

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  // «Свой диапазон» только раскрывает пикер (период становится «своим»,
  // лишь когда реально выбрали дату). При раскрытии лист сам доскролливает
  // к пикеру — иначе колесо уезжает под нижний край, «лисни ещё ниже».
  const openCustom = () => {
    const next = !customOpen;
    haptics.tap();
    setCustomOpen(next);
    if (next)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  // Черновик для пикеров, пока период ещё не «свой»: сид из текущего
  // пресета или сегодня..сегодня (применяется только при onChange пикера).
  const draftFrom = filter.period?.from ?? formatYMD(new Date());
  const draftTo = filter.period?.to ?? formatYMD(new Date());

  const setCustomRange = (from: string, to: string) => {
    // Перевёрнутый диапазон дал бы пустое окно — меняем местами.
    const [f, tt] = from <= to ? [from, to] : [to, from];
    onChange({ ...filter, period: { preset: "custom", from: f, to: tt } });
  };

  // Сегмент «С | До» (диалект Финансов): выбирает край, который правит
  // единственное колесо. Активный край — на белой плашке, дата под подписью.
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
          height: 46,
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
      {/* Шапка листа (диалект Финансов): слева — заголовок, справа —
          «Сбросить». Закрытие: тап по фону или «Показать N». */}
      <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
        <Text className="text-lg font-bold" style={{ color: t.ink }}>
          Фильтры
        </Text>
        <Pressable
          onPress={() => {
            if (nothingActive) return;
            haptics.tap();
            onChange(resetFilters(filter));
          }}
          disabled={nothingActive}
          accessibilityRole="button"
          accessibilityLabel="Сбросить фильтры"
          accessibilityState={{ disabled: nothingActive }}
          className="min-h-11 justify-center px-1 active:opacity-60"
        >
          <Text
            className="text-[15px] font-semibold"
            style={{ color: nothingActive ? t.faint : t.accent }}
          >
            Сбросить
          </Text>
        </Pressable>
      </View>

      {/* Прокручиваемое тело — flexShrink, чтобы держаться в потолке
              листа и скроллиться, а не распирать его. */}
      <ScrollView
        ref={scrollRef}
        className="px-4"
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingVertical: 16, gap: 20 }}
      >
        <Section
          icon={<ArrowUpDown color={t.accent} size={15} strokeWidth={2.2} />}
          caption="Порядок"
        >
          <View className="flex-row flex-wrap gap-2">
            {SORT_ORDER.map((k) => (
              <GridPill
                key={k}
                label={SORT_LABELS[k]}
                active={filter.sort === k}
                onPress={() => onChange({ ...filter, sort: k })}
              />
            ))}
          </View>
        </Section>

        {availableSegments.length > 0 ? (
          <Section
            icon={<Sparkles color={t.accent} size={15} strokeWidth={2.2} />}
            caption="Статус"
          >
            <View className="flex-row flex-wrap gap-2">
              {availableSegments.map((s) => {
                // Мультивыбор (AND): «Должники» + «Постоянные» = должники
                // из постоянных. Пусто = все.
                const on = filter.segments.includes(s.key);
                return (
                  <GridPill
                    key={s.key}
                    label={s.label}
                    count={segmentCounts[s.key]}
                    active={on}
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
            </View>
          </Section>
        ) : null}

        {teamOptions.length > 0 ? (
          <Section
            icon={<Users color={t.accent} size={15} strokeWidth={2.2} />}
            caption="Команда"
          >
            <View className="gap-1.5">
              {teamOptions.map((o) => (
                <FacetRow
                  key={o.value}
                  option={o}
                  on={filter.selectedTeams.includes(o.value)}
                  count={facetCounts.team[o.value] ?? 0}
                  onToggle={() =>
                    onChange({
                      ...filter,
                      selectedTeams: toggleIn(filter.selectedTeams, o.value),
                    })
                  }
                  t={t}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {cityOptions.length > 0 ? (
          <Section
            icon={<MapPin color={t.accent} size={15} strokeWidth={2.2} />}
            caption="Метка"
          >
            <View className="gap-1.5">
              {cityOptions.map((o) => (
                <FacetRow
                  key={o.value}
                  option={o}
                  on={filter.selectedCities.includes(o.value)}
                  count={facetCounts.city[o.value] ?? 0}
                  onToggle={() =>
                    onChange({
                      ...filter,
                      selectedCities: toggleIn(filter.selectedCities, o.value),
                    })
                  }
                  t={t}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {tagOptions.length > 0 ? (
          <Section
            icon={<Tag color={t.accent} size={15} strokeWidth={2.2} />}
            caption="Тег"
          >
            <View className="gap-1.5">
              {tagOptions.map((o) => (
                <FacetRow
                  key={o.value}
                  option={o}
                  on={filter.activeTags.includes(o.value)}
                  count={facetCounts.tag[o.value] ?? 0}
                  onToggle={() =>
                    onChange({
                      ...filter,
                      activeTags: toggleIn(filter.activeTags, o.value),
                    })
                  }
                  t={t}
                />
              ))}
            </View>
          </Section>
        ) : null}

        <Section
          icon={<Calendar color={t.accent} size={15} strokeWidth={2.2} />}
          caption="Период"
        >
          <View className="flex-row flex-wrap gap-2">
            <GridPill
              label="Всё время"
              active={isAll}
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
              onPress={openCustom}
            />
          </View>

          {customOpen ? (
            <View
              className="p-3"
              style={{ borderRadius: t.radius.card, backgroundColor: t.canvas }}
            >
              {/* С | До — сегмент выбирает край, одно колесо его крутит
                      (как «Свой период» в Финансах). Применяется вживую. */}
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
            </View>
          ) : null}
        </Section>
      </ScrollView>

      {/* Футер: «Показать N» (live) — просто закрывает. При 0 совпадений
          заливка гаснет (цвет=действие не зовёт тапать) + подсказка. */}
      <View
        className="px-4 pb-8 pt-3"
        style={{ borderTopWidth: 1, borderTopColor: t.separator }}
      >
        {shownCount === 0 ? (
          <Text
            maxFontSizeMultiplier={1.3}
            className="mb-2 text-center text-[13px]"
            style={{ color: t.faint }}
          >
            Смягчите период или статус
          </Text>
        ) : null}
        <Pressable
          onPress={() => {
            haptics.tap();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel={showLabel}
          className="h-12 items-center justify-center active:opacity-85"
          style={{
            borderRadius: t.radius.input,
            backgroundColor: shownCount === 0 ? t.fill : t.accent,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            className="text-[15px] font-semibold"
            style={{ color: shownCount === 0 ? t.sub : t.onAccent }}
          >
            {showLabel}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
