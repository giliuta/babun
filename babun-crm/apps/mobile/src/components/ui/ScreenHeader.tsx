import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { ICON, TYPE } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// Unified screen chrome. Two modes:
//  - default: back chevron + centered-left title + optional right action (44px taps)
//  - large:   big in-flow title for tab roots (no back), optional right action
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  large,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}) {
  const router = useRouter();
  const t = useThemeColors();

  if (large) {
    return (
      <View className="flex-row items-end justify-between px-4 pb-2 pt-4">
        <View className="flex-1">
          <Text style={{ ...TYPE.display, color: t.ink }}>{title}</Text>
          {subtitle ? (
            <Text style={{ fontSize: 14, color: t.sub }}>{subtitle}</Text>
          ) : null}
        </View>
        {right ? <View className="pb-1">{right}</View> : null}
      </View>
    );
  }

  return (
    <View
      className="flex-row items-center px-1 py-1.5"
      style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
    >
      <Pressable
        // Cold deep link (push / state restore) can land here with an empty
        // history — GO_BACK would be a dead button (red screen in dev), so
        // fall back to the app root.
        onPress={
          onBack ??
          (() => (router.canGoBack() ? router.back() : router.replace("/")))
        }
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Назад"
        style={({ pressed }) => ({
          height: 44,
          width: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <ChevronLeft color={t.body} size={ICON.md} />
      </Pressable>
      <View className="flex-1">
        <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 12, color: t.sub }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="min-w-11 items-end pr-1">{right}</View>
    </View>
  );
}
