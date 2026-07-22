import { type ComponentType, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// Standard list row: optional leading (avatar/icon) + title/subtitle +
// optional trailing + optional chevron. 44px+ tap height.
export function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  chevron,
  titleStyle,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  titleStyle?: { color?: string; fontWeight?: "400" | "500" | "600" | "700" };
}) {
  const t = useThemeColors();
  const Comp = (onPress ? Pressable : View) as ComponentType<{
    onPress?: () => void;
    className?: string;
    children?: ReactNode;
    accessibilityRole?: "button";
  }>;
  return (
    <Comp
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-[52px] flex-row items-center px-4 py-2.5 ${
        onPress ? "active:opacity-60" : ""
      }`}
    >
      {leading ? <View className="mr-3">{leading}</View> : null}
      <View className="flex-1 pr-2">
        <Text style={{ fontSize: 16, color: t.ink, ...titleStyle }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <ChevronRight color={t.chevron} size={ICON.sm} /> : null}
    </Comp>
  );
}
