import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "./Button";
import { useThemeColors } from "@/theme/colors";

// Пустое / загрузка / ошибка — одна поверхность на продукт. `fill` занимает
// экран целиком; без него это блок с полями, годный как ListEmptyComponent.
//
// ДЕЙСТВИЕ ЖИВЁТ ВНИЗУ, а не посередине. Владелец 21.09, глядя на состояние
// «Не удалось загрузить документы» в дизайн-системе: «кнопка всегда… вот эти
// вот кнопки, которые посередине, — чтоб они были внизу, как мы привыкли».
// Слова состояния стоят по центру пустоты, «Повторить» — на своём всегдашнем
// месте, во всю ширину над нижним краем. Это же чинит «две двери» у списков,
// где пустое состояние звало кнопкой в центре, а непустое — кнопкой в футере:
// теперь дверь в обоих случаях одна и там же.
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
  // Слова — своим блоком: при `fill` они забирают всю пустоту и встают по её
  // центру, а кнопка остаётся снаружи этого центрирования, внизу.
  const words = fill
    ? "flex-1 items-center justify-center px-8"
    : "items-center px-8 py-16";

  if (state === "loading") {
    return (
      // Роль и подпись несёт сам спиннер: два вложенных accessible-узла
      // VoiceOver склеивает, и подпись пропадала.
      <View className={words}>
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
    <View className={fill ? "flex-1" : undefined}>
      <View className={words}>
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
      </View>
      {action ? (
        // КНОПКА ОДНА НА ПРОДУКТ (сведено 2026-09-10) и стоит там же, где
        // стоит действие любого экрана: во всю ширину, с полем 16 от краёв.
        // Раньше она была компактной по центру — обёртка состояния сжимала её
        // до слова, и «Повторить» выглядело третьей породой кнопки.
        <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
