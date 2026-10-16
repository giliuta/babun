import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import type { useThemeColors } from "@/theme/colors";

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
  const bg = tone === "danger" ? "rgba(240,71,60,0.10)" : "rgba(245,166,35,0.10)";
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
