import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  ArrowUpDown,
  Calendar,
  Check,
  MapPin,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { parseYMD, formatYMD } from "@/features/appointments/helpers";
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

// Волна 2 — порт web ClientsFilterPanel (v812): центрированная карточка
// «Фильтры» с секциями Порядок / Статус (2-col grid) / Команда / Метка /
// Тег (фасеты построчно) / Период (2-col grid + свой диапазон). Все
// контролы применяются LIVE — футер «Показать N» просто закрывает.

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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl border px-3 active:opacity-70"
      style={{
        width: full ? "100%" : "48.3%",
        borderColor: active ? t.accent : "transparent",
        backgroundColor: active
          ? t.dark
            ? `${t.accent}29`
            : `${t.accent}14`
          : t.dark
            ? "rgba(255,255,255,0.07)"
            : "#eef1f5",
      }}
    >
      {active ? <Check color={t.accent} size={14} strokeWidth={2.6} /> : null}
      <Text
        className="text-sm font-semibold"
        numberOfLines={1}
        style={{ color: active ? t.accent : t.ink, flexShrink: 1 }}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          className="text-sm font-semibold"
          style={{
            color: active ? t.accent : t.ink,
            opacity: 0.7,
            fontVariant: ["tabular-nums"],
          }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
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
      onPress={onToggle}
      disabled={dimmed}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: dimmed }}
      accessibilityLabel={`${option.label}, ${count}`}
      className="h-11 flex-row items-center gap-2.5 rounded-xl border px-3 active:opacity-70"
      style={{
        borderColor: on ? t.accent : "transparent",
        backgroundColor: on
          ? t.dark
            ? `${t.accent}29`
            : `${t.accent}14`
          : t.dark
            ? "rgba(255,255,255,0.07)"
            : "#eef1f5",
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
            backgroundColor: t.dark ? `${t.accent}29` : `${t.accent}14`,
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
  const [customOpen, setCustomOpen] = useState(false);

  // Свернуть пикеры, когда период снят снаружи (Сбросить / ✕ токена).
  useEffect(() => {
    if (filter.period === null) setCustomOpen(false);
  }, [filter.period]);

  const { filtered, facetCounts, activeCount, teamOptions, cityOptions, tagOptions } =
    result;
  const shownCount = filtered.length;
  const nothingActive = filterActiveCount(filter) === 0;

  // Пилюля статуса рендерится при совпадениях ИЛИ когда она активна —
  // иначе активный сегмент с упавшим до 0 счётчиком нельзя снять.
  const availableSegments = SEGMENT_OPTIONS.filter(
    (s) => segmentCounts[s.key] > 0 || s.key === filter.segment,
  );

  const isAll = filter.period === null;
  const isCustom = filter.period?.preset === "custom";

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  // Веб-паритет (PeriodSection): «Свой диапазон» только раскрывает пикеры;
  // период становится «своим» лишь когда пользователь реально выбрал дату —
  // иначе тап по кнопке мгновенно фильтровал бы список до «сегодня..сегодня».
  const openCustom = () => setCustomOpen((v) => !v);

  // Черновик для пикеров, пока период ещё не «свой»: сид из текущего
  // пресета или сегодня..сегодня (применяется только при onChange пикера).
  const draftFrom = filter.period?.from ?? formatYMD(new Date());
  const draftTo = filter.period?.to ?? formatYMD(new Date());

  const setCustomRange = (from: string, to: string) => {
    // Перевёрнутый диапазон дал бы пустое окно — меняем местами.
    const [f, tt] = from <= to ? [from, to] : [to, from];
    onChange({ ...filter, period: { preset: "custom", from: f, to: tt } });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 items-center justify-center p-5"
        style={{ backgroundColor: t.scrim }}
      >
        <Pressable
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
          onPress={onClose}
          accessibilityLabel="Закрыть фильтры"
        />
        <View
          className="w-full max-w-[344px] overflow-hidden rounded-3xl"
          style={{ backgroundColor: t.surface, maxHeight: "82%" }}
        >
          {/* Шапка: Сбросить · Фильтры · ✕ */}
          <View
            className="h-[52px] flex-row items-center justify-center px-3"
            style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
          >
            <Pressable
              onPress={() => {
                if (nothingActive) return;
                onChange(resetFilters(filter));
              }}
              disabled={nothingActive}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Сбросить фильтры"
              className="absolute left-3 px-1.5 py-1 active:opacity-60"
            >
              <Text
                className="text-[13px] font-semibold"
                style={{ color: nothingActive ? t.faint : t.accent }}
              >
                Сбросить
              </Text>
            </Pressable>
            <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
              Фильтры
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              className="absolute right-3 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={t.sub} size={18} strokeWidth={2.4} />
            </Pressable>
          </View>

          {/* Прокручиваемое тело */}
          <ScrollView
            className="px-4"
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
                    const on = filter.segment === s.key;
                    return (
                      <GridPill
                        key={s.key}
                        label={s.label}
                        count={segmentCounts[s.key]}
                        active={on}
                        onPress={() =>
                          onChange({ ...filter, segment: on ? "all" : s.key })
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
                  label="Свой диапазон"
                  active={isCustom}
                  full
                  onPress={openCustom}
                />
              </View>

              {customOpen ? (
                <View
                  className="rounded-2xl p-3"
                  style={{ backgroundColor: t.canvas }}
                >
                  <View className="flex-row items-center justify-between py-1.5">
                    <Text className="text-base" style={{ color: t.ink }}>С</Text>
                    <DateTimePicker
                      value={parseYMD(draftFrom)}
                      mode="date"
                      display="compact"
                      onChange={(_, d) =>
                        d && setCustomRange(formatYMD(d), draftTo)
                      }
                    />
                  </View>
                  <View className="flex-row items-center justify-between py-1.5">
                    <Text className="text-base" style={{ color: t.ink }}>По</Text>
                    <DateTimePicker
                      value={parseYMD(draftTo)}
                      mode="date"
                      display="compact"
                      onChange={(_, d) =>
                        d && setCustomRange(draftFrom, formatYMD(d))
                      }
                    />
                  </View>
                </View>
              ) : null}
            </Section>
          </ScrollView>

          {/* Футер: «Показать N» (live) — просто закрывает */}
          <View
            className="p-3"
            style={{ borderTopWidth: 1, borderTopColor: t.separator }}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Показать результаты"
              className="h-12 items-center justify-center rounded-[14px] active:opacity-85"
              style={{ backgroundColor: t.accent }}
            >
              <Text
                className="text-[15px] font-semibold"
                style={{ color: t.onAccent }}
              >
                {shownCount === 0
                  ? "Ничего не найдено"
                  : `Показать ${shownCount} ${countWordRu(
                      shownCount,
                      "клиент",
                      "клиента",
                      "клиентов",
                    )}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
