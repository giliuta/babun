import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

/** Кружок 34pt с акцентным значком — ведущий знак строки выбора. */
export function IconCircle({
  icon: Icon,
  size = 34,
  muted,
}: {
  icon: LucideIcon;
  size?: number;
  /** Дверь ещё закрыта: кружок и глиф гаснут вместе с подписью строки. */
  muted?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: muted ? t.rowFill : `${t.accent}14`,
      }}
    >
      <Icon color={muted ? t.faint : t.accent} size={ICON.sm} />
    </View>
  );
}
