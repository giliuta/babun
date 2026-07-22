import { Switch, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Строка-тумблер списка настроек: подпись (+ необязательное пояснение) слева,
// Switch справа.
//
// Тумблер уместен ТОЛЬКО там, где смыслов ровно два. Настройке, которая умеет
// ещё и наследоваться, нужен ValueRow + OptionSheet: Switch физически не умеет
// сказать «как везде» — попытка выразить третий смысл двумя позициями и
// породила `hide_cancelled: v || null` (выключил тумблер, а отменённые
// по-прежнему скрыты).
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, color: disabled ? t.faint : t.ink }}>{label}</Text>
        {hint ? (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.faint, marginTop: 1 }}>{hint}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.accent }}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
      />
    </View>
  );
}
