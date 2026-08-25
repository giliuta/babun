import { type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

export function AppointmentPhotoAction({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled: boolean;
}) {
  const t = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-[10px] px-3 active:opacity-70"
      style={{ backgroundColor: disabled ? t.disabledFill : `${t.accent}14` }}
    >
      {icon}
      <Text
        className="text-sm font-semibold"
        style={{ color: disabled ? t.faint : t.accent }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
