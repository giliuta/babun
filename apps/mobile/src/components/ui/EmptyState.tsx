import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "./Button";
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
      // Роль и подпись несёт сам спиннер: два вложенных accessible-узла
      // VoiceOver склеивает, и подпись пропадала.
      <View className={wrap}>
        <Spinner size={28} label={title ?? "Загрузка"} />
        {title ? (
          <Text
            style={{
              marginTop: 12,
              textAlign: "center",
              fontSize: 13,
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
          fontSize: 17,
          fontWeight: "600",
          color: state === "error" ? t.danger : t.sub,
        }}
      >
        {title ?? (state === "error" ? "Что-то пошло не так" : "Пусто")}
      </Text>
      {subtitle ? (
        <Text style={{ marginTop: 4, textAlign: "center", fontSize: 13, color: t.faint }}>
          {subtitle}
        </Text>
      ) : null}
      {action ? (
        // КНОПКА ОДНА НА ПРОДУКТ (сведено 2026-09-10). Здесь была своя:
        // 44pt, радиус 999 литералом, кегль 14 — то есть третья геометрия
        // «главного действия» рядом с 52pt/10/17 у `Button` и `GradientButton`.
        // Компактной она остаётся сама: обёртка пустого состояния центрирует
        // детей (`items-center`), и кнопка равна своему слову плюс поля.
        <View style={{ marginTop: 16 }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
