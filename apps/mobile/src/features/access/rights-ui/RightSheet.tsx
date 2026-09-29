import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import { BlockPreview } from "./BlockPreview";
import { rightTitle, stepDanger, stepHint, stepWord } from "./right-words";

// ШТОРКА ОДНОГО ПРАВА (владелец 29.09: «по строке поднимается шторка… и
// сам этот блок вставить визуально в этой шторке сверху»). Сверху — блок
// так, как его увидит сотрудник; ниже — ступени права по возрастанию, у
// каждой пояснение, у опасной — предупреждение. Тап ставит ступень сразу:
// вид сверху меняется на глазах, и шторка уходит сама — «ответ виден, один
// тап». Кнопки нет (канон шторки одиночного выбора).

/** Сколько шторка держит новый вид перед уходом: глаз успевает его увидеть. */
const LINGER_MS = 550;

export function RightSheet({
  visible,
  block,
  blocks,
  levels,
  subtitle,
  teamName,
  teamColor,
  busy = false,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Прошлая ступень ещё сохраняется: вторая запись не ляжет поверх первой. */
  busy?: boolean;
  /** Последнее открытое право — держится и пока шторка уезжает. */
  block: AccessBlock | null;
  blocks: readonly AccessBlock[];
  levels: Readonly<Record<string, AccessLevel>>;
  /** Чьё и где: «Dmitry · Команда 1». */
  subtitle?: string;
  teamName: string;
  teamColor: string;
  onPick: (block: AccessBlock, level: AccessLevel) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const level = block ? (levels[block.key] ?? block.levels[0] ?? "off") : "off";

  const pick = (next: AccessLevel) => {
    if (!block) return;
    if (timer.current) clearTimeout(timer.current);
    if (next === level) {
      onClose();
      return;
    }
    // Две записи не делят один снимок карты (как у строки списка): отказ —
    // коротким тиком, шторка остаётся.
    if (busy) {
      haptics.warning();
      return;
    }
    haptics.tap();
    onPick(block, next);
    timer.current = setTimeout(onClose, LINGER_MS);
  };

  return (
    <BottomSheet
      visible={visible && block !== null}
      onClose={onClose}
      title={block ? rightTitle(block) : undefined}
      subtitle={subtitle}
      padded={false}
      scroll
    >
      {block ? (
        <>
          <BlockPreview block={block} blocks={blocks} levels={levels} teamName={teamName} teamColor={teamColor} />
          <SelectList>
            {block.levels.map((step) => {
              const danger = stepDanger(block, step);
              return (
                <SelectRow
                  key={step}
                  title={stepWord(block, step, levels)}
                  selected={step === level}
                  accessibilityRole="radio"
                  subtitle={
                    <View style={{ gap: 2, paddingBottom: 2 }}>
                      <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 17, color: t.sub }}>
                        {stepHint(block, step, levels)}
                      </Text>
                      {danger ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <AlertTriangle color={t.warning} size={ICON.xs} strokeWidth={2.2} />
                          <Text
                            numberOfLines={2}
                            maxFontSizeMultiplier={1.3}
                            style={{ flex: 1, fontSize: 13, lineHeight: 17, color: t.warning }}
                          >
                            {danger}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  }
                  onPress={() => pick(step)}
                />
              );
            })}
          </SelectList>
        </>
      ) : null}
    </BottomSheet>
  );
}
