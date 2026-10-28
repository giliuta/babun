import { Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { SelectRow } from "@/components/ui/select-rows";
import { whatLine, type RowAccount } from "@/features/finances/record-rows";
import { useThemeColors } from "@/theme/colors";

// ЗАПИСЬ ПЛАНА ДНЯ — ПЛАШКОЙ ЛЕНТЫ «ФИНАНСОВ». Операции дня рисует сам
// `RecordRowView` ленты (`day-rows.ts`); у записи без денег строки ленты нет,
// поэтому плашка своя, но геометрия, подпись (`whatLine`: время · счёт ·
// услуги) и подпись под суммой — те же: под долгом его возраст, как в ленте.

/** Строка записи (долг, план): клиент, время и услуги под ним, сумма справа. */
export function RecordRow({
  name,
  time,
  services,
  accounts,
  amount,
  color,
  status,
  caption,
  icon,
  onPress,
}: {
  name: string;
  time: string | null;
  services: string[];
  /** Счета, через которые прошла оплата записи, — как у строки ленты. */
  accounts?: readonly RowAccount[];
  amount: number;
  color: string;
  /** «оплачено» · «долг» · «ожидается» — для VoiceOver; глазу это говорят
   *  цвет суммы и значок, как в ленте. */
  status?: string;
  /** Под суммой — то, что пишет лента: у долга его возраст. */
  caption?: string;
  icon: LucideIcon;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const what = whatLine({ time, services, accounts });
  return (
    <SelectRow
      icon={icon}
      color={color}
      plain
      title={name}
      // Запись без услуг и без времени — тоже строка: тире держит второй ярус.
      subtitle={what || "—"}
      accessibilityLabel={`${name}, ${status ? `${status} ` : ""}${formatEUR(amount)} — открыть запись`}
      onPress={onPress}
      trailing={
        <View style={{ alignItems: "flex-end", flexShrink: 0, maxWidth: "45%" }}>
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}
          >
            {formatEUR(amount)}
          </Text>
          {caption ? (
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontSize: 13, color: t.faint }}>
              {caption}
            </Text>
          ) : null}
        </View>
      }
    />
  );
}
