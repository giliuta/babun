import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "@/theme/colors";

/** Строки карточки записи у команды: подпись над значением и строка-действие
 *  (маршрут, звонок, карточка клиента). */

export function InfoRow({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 15, color: t.ink }}>{value}</Text>
    </View>
  );
}

export function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 15, color: t.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 12, color: t.sub }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
