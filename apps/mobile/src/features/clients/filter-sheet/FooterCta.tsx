import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/theme/colors";

/** Футер-CTA — общий каркас страницы и попапов. Глагол статичен, катается
 *  ТОЛЬКО меняющаяся часть (число): раньше при каждом пересчёте
 *  перерисовывалась вся надпись, и кнопка «моргала» глаголом. Слот хинта
 *  постоянной высоты — иначе лист прыгал на 26pt прямо под пальцем. */
export function FooterCta({
  t,
  verb,
  roll,
  hint,
  a11yLabel,
  a11yHint,
  reduced,
  onPress,
}: {
  t: ThemeColors;
  /** Статичная часть надписи («Показать », «Готово · »). */
  verb: string;
  /** Меняющаяся часть («12 клиентов») — она и катается. */
  roll?: string | null;
  /** Строка над кнопкой; null держит место, не показывая текста. */
  hint?: string | null;
  a11yLabel: string;
  a11yHint: string;
  reduced: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Первый кадр не анимируем: иначе счётчик «влетал» при каждом открытии.
  const firstFrame = useRef(true);
  useEffect(() => {
    firstFrame.current = false;
  }, []);
  const animate = !reduced && !firstFrame.current;
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 12) + 2,
      }}
    >
      {/* Подсказка печатается ТОЛЬКО когда есть что сказать. Прежде здесь
          стояла невидимая строка-распорка (opacity 0, minHeight 16) — она
          держала место «чтобы кнопка не прыгала», но в половинном листе это
          25pt пустоты над главным действием. Кнопка и так не прыгает:
          подсказка появляется вместе с изменением набора. */}
      {hint ? (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            marginBottom: 8,
            textAlign: "center",
            fontSize: 13,
            color: t.faint,
          }}
        >
          {hint}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={a11yHint}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 52,
          borderRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: t.accent,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 17, fontWeight: "600", color: t.onAccent }}
        >
          {verb}
        </Text>
        {roll ? (
          <Animated.Text
            key={roll}
            entering={animate ? FadeInUp.duration(160) : undefined}
            exiting={animate ? FadeOutDown.duration(120) : undefined}
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: t.onAccent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {roll}
          </Animated.Text>
        ) : null}
      </Pressable>
    </View>
  );
}
