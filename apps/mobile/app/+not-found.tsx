import { Link, Stack } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

export default function NotFound() {
  const t = useThemeColors();
  return (
    <>
      <Stack.Screen options={{ title: "Не найдено" }} />
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: t.canvas }}
      >
        <Text
          accessibilityRole="header"
          className="mb-4 text-lg"
          style={{ color: t.ink }}
        >
          Экран не найден
        </Text>
        <Link href="/" asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="На главную"
            style={({ pressed }) => ({
              minHeight: 44,
              borderRadius: 999,
              justifyContent: "center",
              paddingHorizontal: 18,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Text style={{ color: t.accent, fontWeight: "600" }}>
              На главную
            </Text>
          </Pressable>
        </Link>
      </View>
    </>
  );
}
