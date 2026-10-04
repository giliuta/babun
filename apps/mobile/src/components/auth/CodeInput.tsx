import { forwardRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useAuthTheme } from "@/components/auth/theme";

/** Цифр в коде из письма — настройка Supabase «Email OTP length» (6, 04.10). */
export const EMAIL_CODE_LENGTH = 6;

// Код из письма — клетки по цифре. Набор идёт в одно скрытое поле поверх
// клеток: так работают вставка, стирание и подсказка кода из Почты над
// клавиатурой (`oneTimeCode`), а клетки только рисуют набранное.
export const CodeInput = forwardRef<
  TextInput,
  {
    value: string;
    onChange: (code: string) => void;
    onComplete: (code: string) => void;
    disabled?: boolean;
  }
>(function CodeInput({ value, onChange, onComplete, disabled }, ref) {
  const t = useAuthTheme();
  const [focused, setFocused] = useState(false);

  function handleChange(raw: string) {
    const code = raw.replace(/\D/g, "").slice(0, EMAIL_CODE_LENGTH);
    onChange(code);
    if (code.length === EMAIL_CODE_LENGTH) onComplete(code);
  }

  return (
    <Pressable
      accessibilityLabel="Код из письма"
      onPress={() => (ref && typeof ref !== "function" ? ref.current?.focus() : undefined)}
      style={{ flexDirection: "row", gap: 8 }}
    >
      {Array.from({ length: EMAIL_CODE_LENGTH }, (_, i) => {
        const active = focused && i === Math.min(value.length, EMAIL_CODE_LENGTH - 1);
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: 56,
              borderRadius: t.radius.input,
              backgroundColor: t.surface,
              boxShadow: t.cardShadow,
              borderWidth: 1.5,
              borderColor: active ? t.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 24, fontWeight: "700", color: t.ink }}
            >
              {value[i] ?? ""}
            </Text>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={EMAIL_CODE_LENGTH}
        caretHidden
        accessibilityLabel="Код из письма"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.02,
          color: "transparent",
        }}
      />
    </Pressable>
  );
});
