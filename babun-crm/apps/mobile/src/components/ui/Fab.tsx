import { type ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Plus } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// «Halo Cobalt» FAB — DS §3/§4: 56×56, inset 20 bottom-right, the cobalt
// gradient (one of the only brand-gradient surfaces: logo · CTA · FAB) with
// the accent-tinted floating shadow.
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

export function Fab({
  onPress,
  accessibilityLabel,
  icon,
  style,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  /** Defaults to a «+». */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          position: "absolute",
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.accentTo,
          boxShadow: t.brandShadow,
          opacity: pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="fab" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accentFrom} />
            <Stop offset="1" stopColor={t.accentTo} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fab)" />
      </Svg>
      {icon ?? <Plus color={t.onAccent} size={28} />}
    </Pressable>
  );
}
