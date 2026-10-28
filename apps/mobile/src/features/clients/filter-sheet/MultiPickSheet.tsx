import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { ListX } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ICON } from "@/components/ui/tokens";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import type { FacetOption } from "../filter";
import { CLIENT_NOUN, type Noun3 } from "./constants";
import { FooterCta } from "./FooterCta";
import { PickRow } from "./PickRow";

/** Попап мультивыбора — общая грамматика блоков: контейнеры попапа
 *  периода (блоки canvas без подписей, ряды 52 — `LIST_ROW`), отметка = оттиск.
 *  Live-apply, тап НЕ закрывает — накликивается набор. «Применить · N»
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
  /** Что считается в счётчиках и «Применить · N» (по умолчанию — клиенты). */
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
    // Шапка — общая `BottomSheet`: имя по центру, подпись фасета под ним,
    // «Убрать всё» — значком в слоте действия шапки.
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      maxHeightRatio={0.85}
      title={title}
      subtitle={subtitle}
      headerAction={
        selected.length > 0 ? (
          // Слот действия шапки — 44pt под значок (имя листа держится по
          // центру): слово «Убрать» в него не влезало и упиралось в край.
          <Pressable
            onPress={() => {
              haptics.tap();
              onClear();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Убрать всё в «${title}»`}
            hitSlop={10}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <ListX color={t.accent} size={ICON.command} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
    >
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
        // команде. Поле мёртвых рядов не говорит ничего; пустое состояние
        // общее и называет только то, чего нет (DESIGN-SYSTEM, LOCKED 08-27).
        <EmptyState title="Ничего не найдено" />
      )}
      <FooterCta
        t={t}
        verb="Применить"
        roll={
          shownCount === 0
            ? null
            : ` · ${shownCount} ${countWordRu(shownCount, ...noun)}`
        }
        hint={zeroHint}
        a11yLabel={
          shownCount === 0
            ? "Применить"
            : `Применить, ${shownCount} ${countWordRu(shownCount, ...noun)}`
        }
        a11yHint="Возвращает к фильтрам"
        onPress={onClose}
      />
    </BottomSheet>
  );
}
