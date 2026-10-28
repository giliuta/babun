import { Text, View } from "react-native";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";

// ОДНА ОПЕРАЦИЯ — ОДНА СТРОКА В ОБОИХ МЕСТАХ. «Финансы дня» рисовали её своей
// строкой (56pt, пилюля, контекст над названием, сумма 16/700), а лента
// «Финансов» — плашкой `SelectRow` (52pt, плитка вида денег, 15/13): та же
// оплата выглядела двумя разными вещами. Здесь — геометрия ленты.

const noop = () => {};

function Amount({ text, color, caption }: { text: string; color: string; caption?: string }) {
  const t = useThemeColors();
  return (
    <View style={{ alignItems: "flex-end", flexShrink: 0, maxWidth: "45%" }}>
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}
      >
        {text}
      </Text>
      {caption ? (
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontSize: 13, color: t.faint }}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** Строка операции — плашка ленты «Финансов»: плитка вида денег его цветом,
 *  название, под ним контекст, сумма справа. */
export function TxRow({
  context,
  title,
  amount,
  outflow,
  onPress,
}: {
  context: string;
  title: string;
  amount: number;
  outflow: boolean;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const color = outflow ? t.danger : t.success;
  const money = `${outflow ? "−" : ""}${formatEUR(Math.abs(amount))}`;
  return (
    <SelectRow
      icon={outflow ? TrendingDown : TrendingUp}
      color={color}
      plain
      title={title}
      subtitle={context || "—"}
      accessibilityLabel={`${title}, ${outflow ? "списание" : "поступление"} ${formatEUR(Math.abs(amount))}`}
      // Без двери плашка — показание: нажатие ничего не делает.
      onPress={onPress ?? noop}
      trailing={<Amount text={money} color={color} />}
    />
  );
}

/** Строка записи (долг, план) — та же плашка: имя, время и работа под ним,
 *  сумма справа, состояние словом под суммой. */
export function RecordRow({
  name,
  context,
  amount,
  color,
  status,
  icon,
  onPress,
}: {
  name: string;
  context: string;
  amount: number;
  color: string;
  /** «оплачено» · «долг» · «ожидается» — словом под суммой, в плане дня. */
  status?: string;
  icon: LucideIcon;
  onPress: () => void;
}) {
  return (
    <SelectRow
      icon={icon}
      color={color}
      plain
      title={name}
      subtitle={context || "—"}
      accessibilityLabel={`${name}, ${status ? `${status} ` : ""}${formatEUR(amount)} — открыть запись`}
      onPress={onPress}
      trailing={<Amount text={formatEUR(amount)} color={color} caption={status} />}
    />
  );
}
