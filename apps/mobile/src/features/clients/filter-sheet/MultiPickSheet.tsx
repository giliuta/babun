import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useThemeColors } from "@/theme/colors";
import type { FacetOption } from "../filter";
import { CLIENT_NOUN, type Noun3 } from "./constants";
import { FooterCta } from "./FooterCta";
import { PickRow } from "./PickRow";

/** Попап мультивыбора — общая грамматика блоков: контейнеры попапа
 *  периода (блоки canvas без подписей, ряды 48), отметка = оттиск.
 *  Live-apply, тап НЕ закрывает — накликивается набор. «Готово · N»
 *  (и скрим/свайп) возвращают на СТРАНИЦУ фильтров, где выбранное
 *  видно в строке; на список ведёт только CTA страницы (тап не должен
 *  «перекидывать в клиенты»). */
export function MultiPickSheet({
  visible,
  title,
  subtitle,
  blocks,
  blockTitles,
  rules,
  selected,
  counts,
  shownCount,
  zeroHint,
  reduced,
  noun = CLIENT_NOUN,
  onToggle,
  onClear,
  onClose,
}: {
  /** Что считается в счётчиках и «Готово · N» (по умолчанию — клиенты). */
  noun?: Noun3;
  visible: boolean;
  title: string;
  /** Подпись-семантика под заголовком — своя у каждого фасета. */
  subtitle: string;
  blocks: FacetOption[][];
  /** Имена блоков — по одному на блок. Без них два соседних контейнера
   *  читаются как случайный разрыв списка. */
  blockTitles?: string[];
  /** Правило ряда по его значению — печатается второй строкой. */
  rules?: Record<string, string>;
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
    <BottomSheet padded={false} visible={visible} onClose={onClose} maxHeightRatio={0.85}>
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
            accessibilityLabel={`Убрать всё в «${title}»`}
            hitSlop={10}
            style={{ minHeight: 32, justifyContent: "center" }}
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
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        >
          {blocks.map((block, bi) =>
            block.length === 0 ? null : (
              // Материал несёт сам ряд (канон «Оттиск») — блок прозрачный.
              <View key={bi} style={{ marginBottom: 8 }}>
                {blockTitles?.[bi] ? (
                  <Text
                    accessibilityRole="header"
                    maxFontSizeMultiplier={1.2}
                    style={{
                      marginBottom: 6,
                      marginTop: bi > 0 ? 6 : 0,
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
            : ` · ${shownCount} ${countWordRu(shownCount, ...noun)}`
        }
        hint={zeroHint}
        a11yLabel={
          shownCount === 0
            ? "Готово"
            : `Готово, ${shownCount} ${countWordRu(shownCount, ...noun)}`
        }
        a11yHint="Возвращает к фильтрам"
        onPress={onClose}
      />
    </BottomSheet>
  );
}
