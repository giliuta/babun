import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useMoney } from "@/features/settings/currency";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// Cells of the two money rows (`VatLooks.tsx`): row, number pill, unit, sum
// and the key.

/** Клавиша одной ширины на обе строки — иначе строка едет под пальцем. */
export const KEY_W = 80;
export const RATE_W = 76;
export const VAT_W = 70;
export const COL_GAP = 8;

export function Row({
  strong,
  children,
}: {
  strong?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        minHeight: strong ? 48 : 44,
        paddingHorizontal: 14,
        borderTopWidth: strong ? 0 : 1,
        borderTopColor: t.separator,
      }}
    >
      {children}
    </View>
  );
}

/** Колонка числа рядом с клавишей: число прижато к своей единице. */
/** Число рядом с клавишей — ПИЛЮЛЕЙ одной ширины у скидки и у ставки
 *  (столбиками, ровно). Знак, число и единица внутри, число прижато к единице —
 *  «0 %» над «+19 %» стоят рамка в рамку. */
export function Rate({ children }: { children?: ReactNode }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: RATE_W,
        height: 32,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: 8,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      {children}
    </View>
  );
}

export function Unit({ children }: { children: ReactNode }) {
  const t = useThemeColors();
  return (
    <Text style={{ fontSize: 14, fontWeight: "600", color: t.sub }}>
      {children}
    </Text>
  );
}

/** Сумма строки — в той же колонке, что «СУММА» у работ. */
export function Sum({ value }: { value: number }) {
  const t = useThemeColors();
  // Валюта компании, как у единицы скидки рядом (`useMoney().symbol`): «€»
  // гвоздём у компании не в евро печатал суммы строк чужой валютой.
  const { fmtExact } = useMoney();
  return (
    <Text
      style={{
        // Прижата к правому краю, как «К ОПЛАТЕ» строкой ниже: две итоговые
        // суммы шторки стоят одна под другой (итого чётко по колонкам).
        flex: 1,
        minWidth: 96,
        textAlign: "right",
        fontSize: 15,
        fontWeight: "700",
        color: t.ink,
        fontVariant: ["tabular-nums"],
      }}
    >
      {fmtExact(value)}
    </Text>
  );
}

/** Подпись-клавиша постоянной ширины, как «%» у скидки. */
export function Key({
  children,
  label,
  hint,
  struck,
  onPress,
}: {
  children: ReactNode;
  label: string;
  hint?: string;
  struck?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={6}
      style={({ pressed }) => ({
        width: KEY_W,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: t.radius.input,
        backgroundColor: t.surface,
        boxShadow: t.cardShadow,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: struck ? t.faint : t.ink,
          textDecorationLine: struck ? "line-through" : "none",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
