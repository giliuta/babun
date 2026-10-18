import { Pressable, Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";

/** Строка операции — грамматика ленты «Финансов»: пилюля цвета знака,
 *  контекст над названием, сумма справа. */
export function TxRow({
  context,
  title,
  amount,
  outflow,
  separated,
  onPress,
}: {
  context: string;
  title: string;
  amount: number;
  outflow: boolean;
  separated?: boolean;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const color = outflow ? t.danger : t.success;
  const money = `${outflow ? "−" : ""}${formatEUR(Math.abs(amount))}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${title}, ${outflow ? "списание" : "поступление"} ${formatEUR(Math.abs(amount))}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingLeft: 16,
        paddingRight: 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
      })}
    >
      <View style={{ width: 6, height: 36, borderRadius: 999, backgroundColor: color }} />
      <View style={{ flex: 1 }}>
        {context ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.faint }}>
            {context}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {title}
        </Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}>
        {money}
      </Text>
    </Pressable>
  );
}

/** Строка записи (долг, план) — грамматика списка должников: имя сверху,
 *  время и работа под ним, сумма справа. Долг — не транзакция, пилюли нет. */
export function RecordRow({
  name,
  context,
  amount,
  color,
  status,
  separated,
  onPress,
}: {
  name: string;
  context: string;
  amount: number;
  color: string;
  /** «оплачено» · «долг» · «ожидается» — словом под суммой, в плане дня. */
  status?: string;
  separated?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${status ? `${status} ` : ""}${formatEUR(amount)} — открыть запись`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "500", color: t.ink }}>
          {name}
        </Text>
        {context ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: t.faint }}>
            {context}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}>
          {formatEUR(amount)}
        </Text>
        {status ? (
          <Text style={{ fontSize: 12, color: t.faint }}>{status}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
