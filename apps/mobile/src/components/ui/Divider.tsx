import { View } from "react-native";
import { useThemeColors } from "@/theme/colors";

// Hairline separator (a color, never a real 1px border — DESIGN-SYSTEM §7).
// `inset` left-margin aligns with list content past a leading avatar/icon.
export function Divider({
  inset = 0,
  strong,
}: {
  inset?: number;
  /** ЧЕРТА ПОДВЕДЕНИЯ ИТОГА, а не шов между строками: линия над «Остатком на
   *  конец». Плотнее обычной ровно настолько, чтобы читаться как «здесь
   *  складывают всё, что выше» — раньше итог отличался от слагаемого на
   *  0.3px обводки, то есть ничем. */
  strong?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        height: 1,
        marginLeft: inset || undefined,
        backgroundColor: strong ? t.separatorStrong : t.separator,
      }}
    />
  );
}
