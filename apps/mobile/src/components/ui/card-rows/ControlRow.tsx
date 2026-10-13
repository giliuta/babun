import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

/** Строка с ГОТОВЫМ КОНТРОЛОМ в хвосте: ярлык слева, нативный контрол
 *  справа (дата ТО). Не FieldRow: значение здесь не текст, и тап по нему
 *  должен открывать системный пикер, а не клавиатуру. */
export function ControlRow({
  label,
  separated,
  children,
}: {
  label: string;
  separated?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        gap: 12,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>{children}</View>
    </View>
  );
}
