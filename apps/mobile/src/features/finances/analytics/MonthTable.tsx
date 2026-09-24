import { Pressable, Text, View } from "react-native";
import { money } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";
import type { MonthRow } from "./analytics-math";

// ПОМЕСЯЧНАЯ ТАБЛИЦА ГОДА — «Период · Доходы · Расходы · Прибыль» и итог
// (образец владельца 2026-09-24). Числа без знака валюты в ячейках: колонки
// читаются столбиком, а «€» в каждой клетке съедал бы ширину телефона —
// валюта названа в шапке. Тап по месяцу — тот же экран за этот месяц.

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** «45 442» — число с разрядами, без валюты. */
const num = (v: number) => money(v).replace(/[^\d\s ,−-]/g, "").trim();

export function MonthTable({
  rows,
  total,
  onOpen,
}: {
  rows: readonly MonthRow[];
  total: MonthRow;
  onOpen: (row: MonthRow) => void;
}) {
  const t = useThemeColors();
  const cell = (text: string, color: string, bold = false) => (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      maxFontSizeMultiplier={1.2}
      style={{
        flex: 1,
        textAlign: "right",
        fontSize: 15,
        fontWeight: bold ? "700" : "500",
        fontVariant: ["tabular-nums"],
        color,
      }}
    >
      {text}
    </Text>
  );
  const head = (text: string) => (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.2}
      style={{ flex: 1, textAlign: "right", fontSize: 12, fontWeight: "700", color: t.caption }}
    >
      {text}
    </Text>
  );
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        <Text style={{ width: 72, fontSize: 12, fontWeight: "700", color: t.caption }}>Месяц</Text>
        {head("Доходы €")}
        {head("Расходы €")}
        {head("Прибыль €")}
      </View>
      {[...rows].reverse().map((r) => (
        <Pressable
          key={r.key}
          onPress={() => onOpen(r)}
          accessibilityRole="button"
          accessibilityLabel={`${monthLabel(r.key)}: доходы ${money(r.income)}, расходы ${money(r.expense)}, прибыль ${money(r.profit)}`}
          accessibilityHint="Открывает разбор месяца"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 44,
            paddingHorizontal: 16,
            borderTopWidth: 1,
            borderTopColor: t.separator,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <Text style={{ width: 72, fontSize: 15, color: t.ink }}>{monthLabel(r.key)}</Text>
          {cell(num(r.income), r.income === 0 ? t.sub : t.success)}
          {cell(num(r.expense), r.expense === 0 ? t.sub : t.danger)}
          {cell(num(r.profit), r.profit < 0 ? t.danger : r.profit === 0 ? t.sub : t.accent)}
        </Pressable>
      ))}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: t.separator,
        }}
      >
        <Text style={{ width: 72, fontSize: 15, fontWeight: "700", color: t.ink }}>Итого</Text>
        {cell(num(total.income), t.success, true)}
        {cell(num(total.expense), t.danger, true)}
        {cell(num(total.profit), total.profit < 0 ? t.danger : t.accent, true)}
      </View>
    </View>
  );
}
