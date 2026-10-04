import { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  FilterRow,
  FooterCta,
  GRABBER_H,
  HALF_RATIO,
  MultiPickSheet,
  SinglePickSheet,
  TOP_GAP,
  type Noun3,
} from "@/features/clients/ClientsFilterSheet";
import type { FacetOption } from "@/features/clients/filter";
import { useReduceMotion } from "@/lib/reduce-motion";
import { useThemeColors } from "@/theme/colors";
import {
  CHANGE_ACTIONS,
  CHANGE_KINDS,
  HISTORY_PERIODS,
  historyFilterCount,
  type HistoryFilter,
  type HistoryPeriod,
} from "./change-log";

// «ФИЛЬТРЫ» ИСТОРИИ ИЗМЕНЕНИЙ — ТЕ ЖЕ, ЧТО В КЛИЕНТАХ (владелец 03.10:
// «фильтрацию как в клиентах — не подразделения под всё, а просто красивые
// фильтры всех изменений»). Половина экрана, шапка «Фильтры | Сбросить»,
// строки «имя ⌄ … значение», выбор — попапом поверх с числом у каждого
// варианта, внизу «Показать N изменений». Детали — из шторки клиентов
// (`ClientsFilterSheet`), второй грамматики фильтра в продукте нет.
//
//   • Период — один выбор (Сегодня · Вчера · 7 дней · 30 дней · Всё время);
//   • Кто — «Я», каждый партнёр, «Система»;
//   • Команда — команды аккаунта;
//   • Что — записи, события, клиенты, деньги, партнёры и права, настройки;
//   • Действие — создано, изменено, удалено, возвращено.

const SLOT = 92;
const CHANGE_NOUN: Noun3 = ["изменение", "изменения", "изменений"];

type Facet = "actors" | "teams" | "kinds" | "actions";

function summarize(options: FacetOption[], selected: string[]) {
  if (selected.length === 0) return null;
  const chosen = options.filter((o) => selected.includes(o.value));
  if (chosen.length === 0) return null;
  return { label: chosen[0].label, extra: chosen.length - 1 };
}

function toggleIn<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function HistoryFilterSheet({
  visible,
  period,
  filter,
  people,
  teams,
  counts,
  shownCount,
  onPeriod,
  onFilter,
  onClose,
}: {
  visible: boolean;
  period: HistoryPeriod;
  filter: HistoryFilter;
  /** «Я», партнёры и «Система» — id автора (`"system"` — сервер). */
  people: FacetOption[];
  teams: FacetOption[];
  counts: Record<Facet, Record<string, number>>;
  shownCount: number;
  onPeriod: (period: HistoryPeriod) => void;
  onFilter: (next: HistoryFilter) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const reduced = useReduceMotion();
  const [open, setOpen] = useState<Facet | "period" | null>(null);
  const pageH = Math.round((winH - insets.top - GRABBER_H - TOP_GAP) * HALF_RATIO);

  const kinds: FacetOption[] = CHANGE_KINDS.map((k) => ({ value: k.value, label: k.label, color: "" }));
  const actions: FacetOption[] = CHANGE_ACTIONS.map((a) => ({ value: a.value, label: a.label, color: "" }));
  const nothingActive = historyFilterCount(filter) === 0 && period === "all";
  const countAcc = `${shownCount} ${countWordRu(shownCount, ...CHANGE_NOUN)}`;
  const periodLabel = HISTORY_PERIODS.find((p) => p.value === period)?.label ?? "Всё время";

  const facets: Record<
    Facet,
    { title: string; subtitle: string; options: FacetOption[]; selected: string[]; show: boolean }
  > = {
    actors: { title: "Кто", subtitle: "Кто сделал изменение", options: people, selected: filter.actors, show: people.length > 1 },
    teams: { title: "Команда", subtitle: "В какой команде", options: teams, selected: filter.teams, show: teams.length > 0 },
    kinds: { title: "Что", subtitle: "Что изменили", options: kinds, selected: filter.kinds, show: true },
    actions: { title: "Действие", subtitle: "Что с этим сделали", options: actions, selected: filter.actions, show: true },
  };

  const setFacet = (facet: Facet, next: string[]) => onFilter({ ...filter, [facet]: next } as HistoryFilter);

  return (
    <BottomSheet padded={false} visible={visible} onClose={onClose} maxHeightRatio={HALF_RATIO}>
      <View style={{ height: pageH }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 38,
            paddingHorizontal: 20,
            paddingTop: 2,
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
              onPress={() => {
                onPeriod("all");
                onFilter({ actors: [], teams: [], kinds: [], actions: [] });
              }}
              disabled={nothingActive}
              accessibilityRole="button"
              accessibilityLabel="Сбросить фильтры"
              accessibilityState={{ disabled: nothingActive }}
              hitSlop={12}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: nothingActive ? "rgba(11,18,32,0.28)" : t.accent,
                }}
              >
                Сбросить
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}
        >
          <FilterRow
            name="Период"
            value={period === "all" ? null : { label: periodLabel, extra: 0 }}
            hint="Открывает выбор периода"
            onPress={() => setOpen("period")}
          />
          <View style={{ gap: 8 }}>
            {(Object.keys(facets) as Facet[])
              .filter((key) => facets[key].show)
              .map((key) => (
                <FilterRow
                  key={key}
                  name={facets[key].title}
                  value={summarize(facets[key].options, facets[key].selected)}
                  onPress={() => setOpen(key)}
                />
              ))}
          </View>
        </ScrollView>

        <FooterCta
          t={t}
          verb={shownCount === 0 ? "К списку" : "Показать "}
          roll={shownCount === 0 ? null : countAcc}
          hint={shownCount === 0 ? "Ничего не найдено — снимите условия" : null}
          a11yLabel={shownCount === 0 ? "К списку" : `Показать ${countAcc}`}
          a11yHint="Закрывает фильтры"
          reduced={reduced}
          onPress={onClose}
        />
      </View>

      {(Object.keys(facets) as Facet[]).map((key) => (
        <MultiPickSheet
          key={key}
          visible={open === key}
          title={facets[key].title}
          subtitle={facets[key].subtitle}
          blocks={[facets[key].options]}
          selected={facets[key].selected}
          counts={counts[key]}
          shownCount={shownCount}
          zeroHint={null}
          reduced={reduced}
          noun={CHANGE_NOUN}
          onToggle={(value) => setFacet(key, toggleIn(facets[key].selected, value))}
          onClear={() => setFacet(key, [])}
          onClose={() => setOpen(null)}
        />
      ))}

      <SinglePickSheet
        visible={open === "period"}
        title="Период"
        subtitle="За какое время показать изменения"
        blocks={[HISTORY_PERIODS.map((p) => ({ value: p.value, label: p.label }))]}
        selected={period}
        onSelect={(value) => {
          onPeriod(value as HistoryPeriod);
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
    </BottomSheet>
  );
}
