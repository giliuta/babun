import { Pressable, Text, View } from "react-native";
import { ChevronRight, FileText } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney } from "./format";

export function InvoiceShortcut({
  openCount,
  outstanding,
  overdue,
  onPress,
}: {
  openCount: number;
  outstanding: number;
  overdue: number;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Инвойсы, к оплате ${formatInvoiceMoney(outstanding)}`}
      className="mx-4 mb-1 mt-1 flex-row items-center rounded-xl px-3.5 active:opacity-70"
      style={{ minHeight: 58, backgroundColor: t.surface }}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${t.accent}16` }}>
        <FileText color={t.accent} size={ICON.sm} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>Инвойсы</Text>
        <Text className="mt-0.5 text-xs" style={{ color: overdue > 0 ? t.danger : t.sub }}>
          {overdue > 0 ? `Просрочено ${formatInvoiceMoney(overdue)}` : `${openCount} ожидают оплаты`}
        </Text>
      </View>
      <Text className="mr-1 text-[15px] font-bold tabular-nums" style={{ color: t.ink }}>
        {formatInvoiceMoney(outstanding)}
      </Text>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}
