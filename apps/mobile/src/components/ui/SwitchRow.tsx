import { Pressable, Switch, Text, View } from "react-native";
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
    // НАЖИМАЕТСЯ ВСЯ СТРОКА, а не только тумблер (владелец 2026-08-17: «тумблер
    // не работает, я не могу убрать тумблер» — он тапал по подписи). Цель
    // касания у `Switch` — 51×31pt в правом углу; строка выглядит нажимаемой
    // целиком, и палец идёт в слово. Теперь работает и то, и другое: сам
    // тумблер `pointerEvents="none"`, чтобы одно касание не переключило дважды
    // (строка + контрол = обратно), а роль и состояние несёт строка.
    <Pressable
      onPress={disabled ? undefined : () => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        // Нажатие УГЛУБЛЯЕТ материал — тот же отклик, что у остальных строк.
        backgroundColor: pressed && !disabled ? t.pressed : "transparent",
      })}
    >
      {/* Колонка текста НЕМАЯ ДЛЯ РОТОРА: и подпись, и подсказку уже несёт сам
          тумблер (`accessibilityLabel`), иначе VoiceOver читает строку дважды
          — сперва текстом, потом контролом. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, paddingRight: 12 }}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, color: disabled ? t.faint : t.ink }}>{label}</Text>
        {hint ? (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.faint, marginTop: 1 }}>{hint}</Text>
        ) : null}
      </View>
      {/* Тумблер здесь — ПОКАЗАНИЕ, а не цель касания: жест собирает строка.
          Роль и озвучку тоже несёт она, поэтому контрол молчит для ротора. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch value={value} disabled={disabled} trackColor={{ true: t.accent }} />
      </View>
    </Pressable>
  );
}
