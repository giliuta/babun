import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// СТРОКА НАСТРОЙКИ — ОДНА НА ВЕСЬ ПРОДУКТ.
//
// Жила копией внутри каждого экрана настроек, и копии уже разъезжались:
// разная высота, разный размер плитки, где-то подпись, где-то нет. Владелец
// 2026-08-09: «полностью всё одинаковое, чтоб не путаться».
//
// Цветная плитка — единственное украшение и одновременно навигационный якорь:
// человек запоминает не текст, а «зелёная — выгрузка». Подпись под названием
// показывает ТЕКУЩЕЕ ЗНАЧЕНИЕ настройки, чтобы не проваливаться ради проверки.

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

export function SettingsRow({
  tile,
  icon: Icon,
  title,
  sub,
  onPress,
}: {
  tile: string;
  icon: IconType;
  title: string;
  /** Текущее значение настройки, не описание кнопки. */
  sub?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}: ${sub}` : title}
      className="min-h-[50px] flex-row items-center gap-3 px-4 py-2.5"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        className="h-7 w-7 items-center justify-center rounded-[14px]"
        style={{ backgroundColor: tile }}
      >
        <Icon color="#fff" size={16} strokeWidth={2} />
      </View>
      <View className="flex-1">
        <Text
          className="text-[15px]"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub ? (
          <Text className="mt-px text-xs" style={{ color: t.faint }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}
