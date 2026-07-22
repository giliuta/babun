import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Labeled text input. Works standalone (value/onChangeText) and pairs cleanly
// with TanStack Form fields (pass value + onChangeText + error from the field).
export function Field({
  label,
  error,
  style,
  accessibilityLabel,
  ...inputProps
}: { label: string; error?: string | null } & TextInputProps) {
  const t = useThemeColors();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ marginBottom: 4, fontSize: 14, fontWeight: "500", color: t.sub }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance="light"
        style={[
          {
            borderRadius: t.radius.input,
            borderWidth: 1,
            borderColor: t.separator,
            minHeight: 48,
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 16,
            color: t.ink,
          },
          style,
        ]}
        {...inputProps}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ marginTop: 4, fontSize: 14, color: t.danger }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
