import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

/** Кружок 34pt с акцентным значком — ведущий знак строки выбора. */
export function IconCircle({ icon: Icon, size = 34 }: { icon: LucideIcon; size?: number }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.accent}14`,
      }}
    >
      <Icon color={t.accent} size={ICON.sm} />
    </View>
  );
}
