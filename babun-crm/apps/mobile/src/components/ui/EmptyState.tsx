import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Consistent empty / loading / error surface. `fill` centers full-screen
// (loading); otherwise it's a padded block usable as a FlatList
// ListEmptyComponent.
export function EmptyState({
  state = "empty",
  title,
  subtitle,
  icon,
  action,
  fill,
}: {
  state?: "empty" | "loading" | "error";
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: { label: string; onPress: () => void };
  fill?: boolean;
}) {
  const t = useThemeColors();
  const wrap = fill
    ? "flex-1 items-center justify-center px-8"
    : "items-center px-8 py-16";

  if (state === "loading") {
    return (
      <View
        className={wrap}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={title ?? "Загрузка"}
      >
        <ActivityIndicator color={t.accent} />
        {title ? (
          <Text
            style={{
              marginTop: 12,
              textAlign: "center",
              fontSize: 14,
              color: t.sub,
            }}
          >
            {title}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className={wrap}>
      {icon ? <View className="mb-3 opacity-40">{icon}</View> : null}
      <Text
        accessibilityRole="header"
        style={{
          textAlign: "center",
          fontSize: 16,
          fontWeight: "500",
          color: state === "error" ? t.danger : t.sub,
        }}
      >
        {title ?? (state === "error" ? "Что-то пошло не так" : "Пусто")}
      </Text>
      {subtitle ? (
        <Text style={{ marginTop: 4, textAlign: "center", fontSize: 14, color: t.faint }}>
          {subtitle}
        </Text>
      ) : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => ({
            marginTop: 16,
            minHeight: 44,
            borderRadius: 999,
            backgroundColor: t.accent,
            paddingHorizontal: 20,
            paddingVertical: 10,
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: t.onAccent }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
