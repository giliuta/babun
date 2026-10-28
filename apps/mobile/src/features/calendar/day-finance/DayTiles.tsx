import { View } from "react-native";
import { formatEURExact as formatEUR, moneySign } from "@babun/shared/common/utils/money";
import { SummaryToggle } from "@/features/finances/FinanceOverview";
import type { dayMoney } from "@/features/calendar/day-money";
import { useThemeColors } from "@/theme/colors";
import type { DayView } from "./types";

// ЧЕТЫРЕ ПЛИТКИ — ТЕ ЖЕ, ЧТО НА «ФИНАНСАХ» (SummaryToggle): цвет
// несёт смысл, тинт — только у выбранной. Пока срез дня в пути,
// цифры гаснут, как гаснет сводка «Финансов» при смене периода.
export function DayTiles({
  money,
  view,
  pick,
  listLoading,
  showDebt,
}: {
  money: ReturnType<typeof dayMoney>;
  view: DayView;
  pick: (next: DayView) => void;
  listLoading: boolean;
  /** Payment block on and visible to this person. */
  showDebt: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 6,
        opacity: listLoading ? 0.4 : 1,
      }}
    >
      <View style={{ flexDirection: "row", gap: 6 }}>
        <SummaryToggle
          label="Доход"
          color={moneySign(money.income) < 0 ? t.danger : t.success}
          value={formatEUR(money.income)}
          // Ноль тише живых денег — как у плиток «Финансов»: красный
          // «€0» у расхода врал цветом.
          quiet={moneySign(money.income) === 0}
          active={view === "income"}
          onPress={() => pick("income")}
        />
        <SummaryToggle
          label="Расход"
          color={t.danger}
          value={formatEUR(money.expense)}
          quiet={moneySign(money.expense) === 0}
          active={view === "expense"}
          onPress={() => pick("expense")}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {/* Долг дня — неоплаченные записи. Без оплаты в записи
            (функция компании выключена, STORY-088) все записи
            выглядели бы долгом — плитки нет. */}
        {showDebt ? (
          <SummaryToggle
            // Слово «Финансов»: та же плитка там — «Долги».
            label="Долги"
            color={t.warning}
            value={formatEUR(money.debt)}
            quiet={moneySign(money.debt) === 0}
            active={view === "debt"}
            onPress={() => pick("debt")}
          />
        ) : null}
        {/* Серым: план — не деньги, а то, что ещё предстоит. */}
        <SummaryToggle
          label="Ожидается"
          color={t.sub}
          value={formatEUR(money.planned)}
          quiet={moneySign(money.planned) === 0}
          active={view === "planned"}
          onPress={() => pick("planned")}
        />
      </View>
    </View>
  );
}
