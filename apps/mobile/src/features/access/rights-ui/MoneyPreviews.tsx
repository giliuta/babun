import { Fragment } from "react";
import { View } from "react-native";
import { Banknote, CreditCard } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { RecordRowView } from "@/features/finances/RecordRow";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import {
  SAMPLE_DEBT,
  SAMPLE_EXPENSE,
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
    case "finance.operations":
      return (
        <PreviewFrame state={levelState(level)}>
          <Card style={{ marginHorizontal: 16, marginTop: 8 }}>
            <RecordRowView row={SAMPLE_INCOME} tone="income" onPress={write ? noop : undefined} />
            <Divider inset={16} />
            <RecordRowView row={SAMPLE_EXPENSE} tone="expense" onPress={write ? noop : undefined} />
          </Card>
          {write ? <Action label="Добавить операцию" /> : null}
        </PreviewFrame>
      );
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
