import { Pressable, Text, View } from "react-native";
import { Check, Lock, type LucideIcon } from "lucide-react-native";
import { TYPE } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ГАЛКИ БЛОКОВ — ОДИН ВИД НА ВСЕ СТРАНИЦЫ, ГДЕ КОМАНДА ВЫБИРАЕТ, ИЗ ЧЕГО
// СОБРАН ЭКРАН: «Записи» (блоки записи и события) и «Карточка клиента»
// (так же, как в записи).
// Строка — значок, слово, справа галка; обязательные — одной тихой строкой
// «Всегда: …» сверху, а не строками с замком.

/** Строка колонки блоков: значок, слово, справа галка (вкл.) или ничего;
 *  обязательный — замок, тапа нет. */
export function BlockCell({
  label,
  icon: Icon,
  on,
  locked,
  readOnly = false,
  fixed = false,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  on: boolean;
  locked: boolean;
  /** Обязательный блок в списке порядка (клиент, услуги записи): включён
   *  всегда — замок вместо галки, но строка живая, её двигают. */
  fixed?: boolean;
  /** «Только видит»: блок показан как есть, тап ничего не меняет. */
  readOnly?: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  // Обязательный — всегда включён и не «запрещён»: строка тёмная, как живая.
  const isOn = fixed || on;
  const isLocked = !fixed && locked;
  const tone = isLocked ? t.faint : isOn ? t.ink : t.faint;
  return (
    <Pressable
      disabled={isLocked || readOnly || fixed}
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isOn, disabled: isLocked || readOnly || fixed }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingLeft: 16,
        paddingRight: 12,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Icon size={17} strokeWidth={2.1} color={isOn && !isLocked ? t.accent : t.faint} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ flex: 1, fontSize: 15, fontWeight: isOn ? "600" : "500", color: tone }}
      >
        {label}
      </Text>
      {isLocked || fixed ? (
        <Lock size={14} strokeWidth={2.2} color={t.faint} />
      ) : isOn ? (
        <Check size={18} strokeWidth={2.6} color={t.accent} />
      ) : null}
    </Pressable>
  );
}

/** «Всегда: команда, время, клиент, услуги» — обязательные блоки формы одной
 *  тихой строкой над выключаемыми. */
export function AlwaysLine({ blocks }: { blocks: readonly { label: string; pinned?: boolean }[] }) {
  const t = useThemeColors();
  const names = blocks.filter((b) => b.pinned).map((b) => b.label.toLowerCase());
  if (names.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 10,
      }}
    >
      <Lock size={14} strokeWidth={2.2} color={t.faint} />
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, fontSize: TYPE.subhead.fontSize, color: t.sub }}>
        Всегда: {names.join(", ")}
      </Text>
    </View>
  );
}
