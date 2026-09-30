import { Fragment } from "react";
import { Text, View } from "react-native";
import { Banknote, CreditCard } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { DateCell } from "@/features/calendar/date-header";
import { RecordRowView } from "@/features/finances/RecordRow";
import { useThemeColors } from "@/theme/colors";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import {
  SAMPLE_DEBT,
  SAMPLE_EXPENSE_OTHER,
  SAMPLE_EXPENSE_OWN,
  SAMPLE_INCOME,
  SAMPLE_INCOME_OTHER,
  SAMPLE_INCOME_OWN,
} from "./preview-sample";

// ВИД ПРАВ ФИНАНСОВ В ШТОРКЕ: строки ленты операций (`RecordRowView` —
// те же, что на «Финансах»), плитки счетов, строка долга. «Меняет» —
// появляется действие, которое открывается на странице финансов.
//
// Доходы и расходы (этап 2): у открытой строки есть дверь, у закрытой нет.
// «Добавляет» открывает только свою операцию, «Правит всё» — и чужую;
// оплата записи в ленте доходов не открывается никогда — её ведёт «Оплата».

const noop = () => {};


function Action({ label }: { label: string }) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 8 }}>
      <Button variant="secondary" label={label} onPress={noop} />
    </View>
  );
}

/** Подпись над видом денег в календаре — что у него на этой ступени. */
const MONEY_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: под днями денег нет",
  read: "Так он видит доход и расход дня",
  write: "Так он добавляет деньги дня",
};

/** Дни и полоса денег под ними — как `DayFinanceFooter` календаря: слева
 *  «Доход / Расход», под каждым днём суммы; ноль — бледный. */
function CalendarMoneyStrip({ money }: { money: boolean }) {
  const t = useThemeColors();
  const days = [
    { date: new Date(2026, 8, 28), income: "€120", spent: "€40" },
    { date: new Date(2026, 8, 29), income: "€0", spent: "€0" },
    { date: new Date(2026, 8, 30), income: "€200", spent: "€25" },
  ];
  const seam = `${t.ink}33`;
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", paddingTop: 6, paddingBottom: 2 }}>
        <View style={{ width: 56 }} />
        {days.map((day) => (
          <DateCell key={day.date.getDate()} date={day.date} size="sm" isToday={false} />
        ))}
      </View>
      {money ? (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: seam, paddingVertical: 7 }}>
          <View style={{ width: 56, paddingRight: 6, alignItems: "flex-end" }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, fontWeight: "600", color: t.sub }}>
              Доход
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 11, fontWeight: "600", color: t.sub }}>
              Расход
            </Text>
          </View>
          {days.map((day, i) => (
            <View
              key={day.date.getDate()}
              style={{ flex: 1, alignItems: "center", borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: seam }}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], color: day.income === "€0" ? t.faint : t.success }}
              >
                {day.income}
              </Text>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], color: day.spent === "€0" ? t.faint : t.danger }}
              >
                {day.spent}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function MoneyPreview({ blockKey, level }: { blockKey: string; level: AccessLevel }) {
  const write = level === "write";
  switch (blockKey) {
    case "finance.income":
    case "finance.expense": {
      const income = blockKey === "finance.income";
      const adds = level === "write" || level === "full";
      const all = level === "full";
      const rows = income
        ? [
            { row: SAMPLE_INCOME, open: false },
            { row: SAMPLE_INCOME_OTHER, open: all },
            { row: SAMPLE_INCOME_OWN, open: adds },
          ]
        : [
            { row: SAMPLE_EXPENSE_OTHER, open: all },
            { row: SAMPLE_EXPENSE_OWN, open: adds },
          ];
      return (
        <PreviewFrame
          state={levelState(level)}
          caption={all ? "Правит всё, и чужое тоже" : adds ? "Добавляет и правит своё" : undefined}
        >
          <Card style={{ marginHorizontal: 16, marginTop: 8 }}>
            {rows.map(({ row, open }, i) => (
              <Fragment key={row.key}>
                {i > 0 ? <Divider inset={16} /> : null}
                <RecordRowView row={row} tone={income ? "income" : "expense"} onPress={open ? noop : undefined} />
              </Fragment>
            ))}
          </Card>
          {adds ? <Action label={income ? "Добавить доход" : "Добавить расход"} /> : null}
        </PreviewFrame>
      );
    }
    case "finance.operations": {
      // ДОХОДЫ И РАСХОДЫ ТАК, КАК ИХ ВИДИТ СОТРУДНИК В КАЛЕНДАРЕ (30.09):
      // «Скрыты» — дни без полосы денег, «Только видит» — полоса под днями,
      // «Видит и меняет» — ещё и кнопки денег дня.
      const state = level === "off" ? "hidden" : write ? "write" : "read";
      return (
        <PreviewFrame
          state={state === "hidden" ? "read" : state}
          caption={MONEY_CAPTION[state]}
          captionOff={state === "hidden"}
        >
          <CalendarMoneyStrip money={state !== "hidden"} />
          {state === "write" ? (
            <>
              <Action label="Добавить доход" />
              <Action label="Добавить расход" />
            </>
          ) : null}
        </PreviewFrame>
      );
    }
    case "finance.accounts":
      return (
        <PreviewFrame state={levelState(level)}>
          <AccountsPreview />
          {write ? <Action label="Перевод между счетами" /> : null}
        </PreviewFrame>
      );
    case "finance.debts":
      return (
        <PreviewFrame state={levelState(level)}>
          <Card style={{ marginHorizontal: 16, marginTop: 8 }}>
            <RecordRowView row={SAMPLE_DEBT} tone="debt" onPress={write ? noop : undefined} />
          </Card>
          {write ? <Action label="Принять оплату" /> : null}
        </PreviewFrame>
      );
    default:
      return null;
  }
}

/** Плитки счетов команды с остатками. */
function AccountsPreview() {
  const width = useTileWidth(2);
  const accounts = [
    { label: "Наличные", icon: Banknote, color: SETTINGS_TILE.green, amount: "€340" },
    { label: "Карта", icon: CreditCard, color: SETTINGS_TILE.blue, amount: "€1 250" },
  ];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8 }}>
      <View className="flex-row flex-wrap" style={{ padding: 16, paddingTop: 12, gap: TILE_GAP }}>
        {accounts.map((account) => (
          <PaymentTile
            key={account.label}
            icon={account.icon}
            label={account.label}
            color={account.color}
            tint={account.color}
            width={width}
            compact
            state="idle"
            amount={account.amount}
            onPress={noop}
            accessibilityLabel={`${account.label}, ${account.amount}`}
          />
        ))}
      </View>
    </Card>
  );
}
