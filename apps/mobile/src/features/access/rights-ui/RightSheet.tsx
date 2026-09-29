import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import { BlockPreview } from "./BlockPreview";
import { stepLook } from "./right-look";
import { rightTitle, stepDanger, stepHint, stepWord } from "./right-words";

// ШТОРКА ОДНОГО ПРАВА (владелец 29.09: «по строке поднимается шторка… и
// сам этот блок вставить визуально в этой шторке сверху»). Сверху — блок
// так, как его увидит сотрудник; ниже — ступени права по возрастанию, у
// каждой значок, пояснение, у опасной — предупреждение.
//
// ВЫБОР — ТАПОМ, ЗАПИСЬ — КНОПКОЙ «ПРИМЕНИТЬ» (владелец 29.09: «когда я
// нажимаю метку дня, я могу выбирать, и там кнопка „Применить"»). Тап по
// ступени только показывает её: вид сверху меняется на глазах, и можно
// сравнить ступени, ничего не выдав сотруднику. Уходит выбранное одной
// записью по «Применить»; закрыли шторку без кнопки — ничего не поменялось.

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
  const level = block ? (levels[block.key] ?? block.levels[0] ?? "off") : "off";
  /** Ступень, выбранная в шторке, но ещё не применённая. */
  const [chosen, setChosen] = useState<AccessLevel>(level);

  // Каждое открытие начинается с того, что стоит сейчас: прошлый выбор без
  // «Применить» не переживает закрытия.
  useEffect(() => {
    if (visible) setChosen(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии и смене права
  }, [visible, block?.key]);

  const shown: Readonly<Record<string, AccessLevel>> = block ? { ...levels, [block.key]: chosen } : levels;

  const apply = () => {
    if (!block) return;
    if (chosen === level) {
      onClose();
      return;
    }
    // Две записи не делят один снимок карты (как у строки списка): отказ —
    // коротким тиком, шторка остаётся.
    if (busy) {
      haptics.warning();
      return;
    }
    haptics.success();
    onPick(block, chosen);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible && block !== null}
      onClose={onClose}
      title={block ? rightTitle(block) : undefined}
      subtitle={subtitle}
      padded={false}
      scroll
      footer={
        block ? (
          <View className="px-5">
            <Button label="Применить" onPress={apply} />
          </View>
        ) : undefined
      }
    >
      {block ? (
        <>
          <BlockPreview block={block} blocks={blocks} levels={shown} teamName={teamName} teamColor={teamColor} />
          <SelectList>
            {block.levels.map((step) => {
              const danger = stepDanger(block, step);
              const look = stepLook(step);
              return (
                <SelectRow
                  key={step}
                  icon={look.icon}
                  color={look.tile}
                  title={stepWord(block, step, shown)}
                  selected={step === chosen}
                  accessibilityRole="radio"
                  subtitle={
                    <View style={{ gap: 2, paddingBottom: 2 }}>
                      <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 17, color: t.sub }}>
                        {stepHint(block, step, shown)}
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
                  onPress={() => {
                    if (step === chosen) return;
                    haptics.tap();
                    setChosen(step);
                  }}
                />
              );
            })}
          </SelectList>
        </>
      ) : null}
    </BottomSheet>
  );
}
