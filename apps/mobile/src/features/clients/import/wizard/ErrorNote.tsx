import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import type { useThemeColors } from "@/theme/colors";
import { tintOver } from "@/components/ui/color-contrast";

export function ErrorNote({
  t,
  text,
  tone = "danger",
}: {
  t: ReturnType<typeof useThemeColors>;
  text: string;
  tone?: "danger" | "warning";
}) {
  const color = tone === "danger" ? t.danger : t.warning;
  // Подложка — тот же смысловой цвет на 10 %, а не старые «сочные» литералы.
  const bg = tintOver(color, t.surface, 0.1);
  return (
    <View
      className="flex-row items-start gap-2 rounded-[10px] px-3 py-2.5"
      style={{ backgroundColor: bg }}
    >
      <AlertTriangle color={color} size={16} strokeWidth={2.2} />
      <Text className="flex-1 text-[13px] leading-snug" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}
