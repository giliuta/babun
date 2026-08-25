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
  left,
  right,
  large,
  seam = true,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Действие СЛЕВА от заголовка — место шестерёнки на корневых экранах
   *  вкладок. Владелец 2026-08-09: «настройки должны быть с левой стороны и
   *  везде, полностью всё одинаковое, чтоб не путаться». */
  left?: ReactNode;
  right?: ReactNode;
  large?: boolean;
  /** Шов под шапкой. Гасится, когда СРАЗУ под ней идёт лента чипов со своим
   *  швом: две линии подряд читаются не как граница, а как случайный зазор. */
  seam?: boolean;
}) {
  const router = useRouter();
  const t = useThemeColors();

  if (large) {
    return (
      <View className="flex-row items-end px-4 pb-2 pt-4" style={{ gap: 10 }}>
        {left ? <View className="pb-1">{left}</View> : null}
        <View className="flex-1">
          <Text accessibilityRole="header" style={{ ...TYPE.display, color: t.ink }}>
            {title}
          </Text>
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
      style={{
        borderBottomWidth: seam ? 1 : 0,
        borderBottomColor: t.separator,
      }}
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
      {/* ЗАГОЛОВОК — ПО ЦЕНТРУ (владелец 2026-08-24: «надпись должна быть
          посередине, мы всё абсолютно в центр»). Это же канон навигационной
          шапки iOS. Центр честный: слева кнопка «назад» 44pt, справа контейнер
          действий с той же минимальной шириной — заголовок стоит ровно
          посередине экрана, а не посередине оставшегося места. */}
      <View className="flex-1 items-center">
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 16,
            fontWeight: "600",
            color: t.ink,
            textAlign: "center",
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{ fontSize: 12, color: t.sub, textAlign: "center" }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="min-w-11 items-end pr-1" style={{ minWidth: 44 }}>{right}</View>
    </View>
  );
}
