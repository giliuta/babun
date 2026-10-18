import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { pct } from "@/features/calendar/grid-units";

// A horizontal band covering [fromMin, toMin] — off-hours wash, past-time
// wash, buffer bands, breaks. `label` — тихая подпись по центру полосы
// (например «Перерыв»); в узких колонках недели не передаётся.
export function MinuteBand({
  fromMin,
  toMin,
  winStartMin,
  winEndMin,
  color,
  label,
}: {
  fromMin: number;
  toMin: number;
  winStartMin: number;
  winEndMin: number;
  color: string;
  label?: string;
}) {
  const t = useThemeColors();
  const totalMin = winEndMin - winStartMin;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: pct(fromMin - winStartMin, totalMin),
        height: pct(toMin - fromMin, totalMin),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 11, fontWeight: "500", color: t.faint }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}
