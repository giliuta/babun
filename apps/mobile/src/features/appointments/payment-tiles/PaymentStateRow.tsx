import type { ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

/** ОДНА строка под малой надписью карточки: слева состояние денег («Долг
 *  €135», «Оплачено») либо — по кнопке суммы — поле «€ Сумма» с остатком,
 *  справа иконки режимов. Блок от нажатия кнопки не растёт (владелец
 *  2026-09-06: «чтобы всё в одной строчке, компактно и красиво»). */
export interface StateRowAmount {
  symbol: string;
  value: string;
  onChangeText: (next: string) => void;
  hint: string;
  hintTone?: "neutral" | "danger";
}

export function PaymentStateRow({
  caption,
  captionColor,
  captionTone = "neutral",
  amount,
  right,
}: {
  caption?: string;
  captionColor?: string;
  /** Денежное состояние печатается крупно, подсказка — тише. */
  captionTone?: "neutral" | "money";
  /** Открытое поле суммы занимает место подписи. */
  amount?: StateRowAmount;
  right?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ paddingHorizontal: 16, minHeight: 40, gap: 10 }}
    >
      {amount ? (
        <>
          <View
            className="flex-row items-center"
            style={{
              flex: 1,
              height: 36,
              borderRadius: t.radius.input,
              borderCurve: "continuous",
              backgroundColor: t.fill,
              paddingHorizontal: 10,
              gap: 4,
            }}
          >
            <Text
              accessible={false}
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.faint }}
            >
              {amount.symbol}
            </Text>
            <TextInput
              value={amount.value}
              onChangeText={amount.onChangeText}
              autoFocus
              keyboardType="decimal-pad"
              placeholder="Сумма"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Сумма"
              maxFontSizeMultiplier={1.2}
              style={{
                flex: 1,
                padding: 0,
                fontSize: 16,
                fontWeight: "600",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            />
          </View>
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: "600",
              color: amount.hintTone === "danger" ? t.danger : t.sub,
              fontVariant: ["tabular-nums"],
            }}
          >
            {amount.hint}
          </Text>
        </>
      ) : (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            flex: 1,
            fontSize: captionTone === "money" ? 17 : 15,
            fontWeight: captionTone === "money" ? "600" : "500",
            color: captionColor ?? t.sub,
            fontVariant: ["tabular-nums"],
          }}
        >
          {caption ?? ""}
        </Text>
      )}
      {right ? (
        <View className="flex-row items-center" style={{ gap: 2 }}>
          {right}
        </View>
      ) : null}
    </View>
  );
}
