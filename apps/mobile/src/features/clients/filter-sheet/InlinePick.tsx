import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import type { FacetOption } from "../filter";
import { CLIENT_NOUN, type Noun3 } from "./constants";
import { PickRow } from "./PickRow";

// ВЫБОР РАСКРЫВАШКОЙ ПОД СТРОКОЙ, А НЕ ШТОРКОЙ ПОВЕРХ ЛИСТА «ФИЛЬТРЫ».
// Шторка поверх шторки — два модальных окна в одном кадре: iOS показывает их
// цепочкой, лист под ней тускнеет, «Готово · N» уводило обратно на лист, где
// уже стоит своя кнопка «Показать N». Варианты раскрываются прямо под своей
// строкой (канон AGENTS 5.1: из листа — раскрывашкой), набор применяется
// сразу, итог — на кнопке листа.

/** Мультивыбор фасета: блоки оттиск-рядов со счётчиками, «Убрать» снимает
 *  набор этого фасета. Тап не сворачивает — накликивается набор. */
export function InlineMultiPick({
  name,
  subtitle,
  blocks,
  blockTitles,
  rules,
  selected,
  counts,
  reduced,
  noun = CLIENT_NOUN,
  onToggle,
  onClear,
}: {
  /** Имя строки — для озвучки «Убрать» («Убрать всё в «Теги»»). */
  name: string;
  /** Семантика набора словами — своя у каждого фасета. */
  subtitle: string;
  blocks: FacetOption[][];
  /** Имена блоков — по одному на блок. */
  blockTitles?: string[];
  /** Правило ряда по его значению — второй строкой. */
  rules?: Record<string, string>;
  selected: string[];
  counts: Record<string, number>;
  reduced: boolean;
  noun?: Noun3;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const t = useThemeColors();
  // СЧЁТЧИКИ ЖИВЫЕ: число у ряда — сколько клиентов он даст при нынешнем
  // наборе. Замороженное на раскрытии, оно после первого тапа врало: ряд
  // обещал 12, а давал 3. Ряды при этом не переставляются — порядок от
  // чисел не зависит, меняются только цифры.
  const shown = counts;
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const alive = blocks.some((b) =>
    b.some((o) => (shown[o.value] ?? 0) > 0 || selected.includes(o.value)),
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 4 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ flex: 1, fontSize: 13, color: t.faint }}
        >
          {subtitle}
        </Text>
        {selected.length > 0 ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClear();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Убрать всё в «${name}»`}
            hitSlop={10}
            style={{ minHeight: 24, justifyContent: "center" }}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
            >
              Убрать
            </Text>
          </Pressable>
        ) : null}
      </View>
      {alive || total === 0 ? (
        blocks.map((block, bi) =>
          block.length === 0 ? null : (
            <View key={bi}>
              {blockTitles?.[bi] ? (
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.2}
                  style={{
                    marginBottom: 6,
                    paddingHorizontal: 4,
                    fontSize: 13,
                    fontWeight: "600",
                    color: t.sub,
                  }}
                >
                  {blockTitles[bi]}
                </Text>
              ) : null}
              <View
                style={{
                  borderRadius: t.radius.card,
                  overflow: "hidden",
                  backgroundColor: t.rowFill,
                }}
              >
                {block.map((o, i) => (
                  <PickRow
                    key={o.value}
                    label={o.label}
                    rule={rules?.[o.value]}
                    active={selected.includes(o.value)}
                    separated={i > 0}
                    tick={o.color || undefined}
                    count={shown[o.value] ?? 0}
                    reduced={reduced}
                    noun={noun}
                    onToggle={() => onToggle(o.value)}
                  />
                ))}
              </View>
            </View>
          ),
        )
      ) : (
        <EmptyState title="Ничего не найдено" />
      )}
    </View>
  );
}

/** Одиночный выбор («Сортировка»): галка = один, тап применяет и сворачивает. */
export function InlineSinglePick({
  blocks,
  selected,
  onSelect,
}: {
  /** Смысловые группы рядов — разделены воздухом. */
  blocks: { value: string; label: string }[][];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block, bi) =>
        block.length === 0 ? null : (
          <View
            key={bi}
            accessibilityRole="radiogroup"
            style={{
              borderRadius: t.radius.card,
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
                    onSelect(o.value);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.label}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    minHeight: 44,
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: t.separator,
                    backgroundColor: pressed ? t.rowFillPressed : "transparent",
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
    </View>
  );
}
