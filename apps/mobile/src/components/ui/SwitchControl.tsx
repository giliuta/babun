import { Switch, type StyleProp, type ViewStyle } from "react-native";
import { useThemeColors } from "@/theme/colors";

// ТУМБЛЕР — одна дверь на все платформы. На телефоне это системный UISwitch,
// ровно как раньше. Веб получает двойника `SwitchControl.web.tsx` в пропорциях
// iPhone: тумблер react-native-web «материальный» — бирюзовый кружок, дорожка
// в 70% высоты, а у выключенного дорожки нет вовсе (найдено сборкой для Claude
// Design 21.09; веб-версия приложения показывала то же самое).

export interface SwitchControlProps {
  value: boolean;
  disabled?: boolean;
  /** Нет — тумблер только показывает (жест собирает строка, как в SwitchRow). */
  onValueChange?: (next: boolean) => void;
  /** Подпись для ротора там, где тумблер сам себе цель касания. Строке-тумблеру
   *  она не нужна: там озвучивает строка, а контрол молчит. */
  accessibilityLabel?: string;
  /** Рамка снаружи тумблера — приглушение запертой строки и подобное. Цвета
   *  дорожки сюда не приходят: облик тумблера один на всё приложение. */
  style?: StyleProp<ViewStyle>;
}

export function SwitchControl({
  value,
  disabled,
  onValueChange,
  accessibilityLabel,
  style,
}: SwitchControlProps) {
  const t = useThemeColors();
  return (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      accessibilityLabel={accessibilityLabel}
      style={style}
      trackColor={{ true: t.accent }}
    />
  );
}
