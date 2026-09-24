import { Pressable, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import type { SwitchControlProps } from "./SwitchControl";

// ВЕБ-ДВОЙНИК ТУМБЛЕРА — пропорции UISwitch (51×31, кружок 27, белый, с
// тенью), дорожка акцентом во включённом и светло-серая в выключенном. Вид —
// тот же, что на iPhone; см. `SwitchControl.tsx`.

const OFF_TRACK = "#e9e9eb";

export function SwitchControl({
  value,
  disabled,
  onValueChange,
  accessibilityLabel,
  style,
}: SwitchControlProps) {
  const t = useThemeColors();
  const track = (
    // Внешняя рамка места вызова идёт ПОСЛЕ своих правил: приглушение запертой
    // строки (`opacity`) должно перебивать приглушение `disabled`, а не
    // умножаться на него.
    <View
      style={[
        {
          width: 51,
          height: 31,
          borderRadius: 16,
          padding: 2,
          justifyContent: "center",
          backgroundColor: value ? t.accent : OFF_TRACK,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 27,
          height: 27,
          borderRadius: 14,
          backgroundColor: "#ffffff",
          transform: [{ translateX: value ? 20 : 0 }],
          boxShadow: "0px 3px 8px rgba(0,0,0,0.15), 0px 1px 1px rgba(0,0,0,0.16)",
        }}
      />
    </View>
  );
  // Без обработчика тумблер — показание: роль и подпись несёт строка вокруг
  // него (SwitchRow), поэтому здесь ни роли, ни подписи.
  if (!onValueChange) return track;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      // ПОЛОЖЕНИЕ — ЧЕРЕЗ `aria-checked`, А НЕ `accessibilityState`:
      // react-native-web 0.21 разбирает только `aria-*` (см. `createDOMProps`),
      // и `accessibilityState` до разметки не доезжает вовсе — экранный диктор
      // читал бы «переключатель» без «включено/выключено», хотя у прежнего
      // `<Switch>` состояние несла сама галочка `<input type="checkbox">`.
      // `disabled` у Pressable сам становится `aria-disabled`.
      aria-checked={value}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
    >
      {track}
    </Pressable>
  );
}
