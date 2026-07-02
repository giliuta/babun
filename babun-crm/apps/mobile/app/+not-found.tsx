import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
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
        <Text className="mb-4 text-lg" style={{ color: t.ink }}>
          Экран не найден
        </Text>
        <Link href="/" style={{ color: t.accent, fontWeight: "600" }}>
          На главную
        </Link>
      </View>
    </>
  );
}
