import type { ReactElement } from "react";
import { View } from "react-native";
import { getDebtAmount, type Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { RowGroup } from "@/components/ui/card-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { humanDayYear } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { RecordRow, TxRow } from "./rows";
import type { DayView } from "./types";

type PlanItem = { key: string; time: string; record?: Appointment; tx?: FinanceTransaction };

// Пусто — ничего: плитка уже сказала «€0», кнопка внизу — что
// делать. Только загрузка движется, иначе «грузится» и «пусто»
// были бы неотличимы.
export function DayList({
  ymd,
  view,
  teamId,
  listLoading,
  listEmpty,
  dayPlan,
  listRecords,
  listTx,
  listExtras,
  clientName,
  servicesOf,
  recordStatus,
  openRecord,
  swipeTx,
  rowContext,
  rowTitle,
  rowAction,
  writesLegacySide,
  askRemoveLegacy,
}: {
  ymd: string;
  view: DayView;
  teamId: string | null;
  listLoading: boolean;
  listEmpty: boolean;
  dayPlan: PlanItem[];
  listRecords: Appointment[];
  listTx: FinanceTransaction[];
  listExtras: DayExtra[];
  clientName: (a: Appointment) => string;
  servicesOf: (a: Appointment) => string;
  recordStatus: (a: Appointment) => { word: string; amount: number; color: string };
  openRecord: (appointmentId: string) => void;
  swipeTx: (key: string, tx: FinanceTransaction, row: ReactElement) => ReactElement;
  rowContext: (tx: FinanceTransaction) => string;
  rowTitle: (tx: FinanceTransaction) => string;
  rowAction: (tx: FinanceTransaction) => (() => void) | undefined;
  writesLegacySide: (side: "income" | "expense") => boolean;
  askRemoveLegacy: (e: DayExtra) => void;
}) {
  const t = useThemeColors();
  return listLoading ? (
    <EmptyState state="loading" />
  ) : listEmpty ? null : (
    <RowGroup title={humanDayYear(ymd)}>
      {view === "all"
        ? dayPlan.map((item, i) =>
            item.record ? (
              <RecordRow
                key={item.key}
                name={clientName(item.record)}
                context={[item.record.time_start, servicesOf(item.record)]
                  .filter(Boolean)
                  .join(" · ")}
                amount={recordStatus(item.record).amount}
                color={recordStatus(item.record).color}
                status={recordStatus(item.record).word}
                separated={i > 0}
                onPress={() => openRecord(item.record!.id)}
              />
            ) : item.tx ? (
              swipeTx(
                item.key,
                item.tx,
                <TxRow
                  key={item.key}
                  context={rowContext(item.tx)}
                  title={rowTitle(item.tx)}
                  amount={item.tx.amount}
                  outflow={item.tx.type === "expense" || item.tx.type === "refund"}
                  separated={i > 0}
                  onPress={rowAction(item.tx)}
                />,
              )
            ) : null,
          )
        : null}
      {listRecords.map((a, i) => (
        <RecordRow
          key={a.id}
          name={clientName(a)}
          context={[a.time_start, servicesOf(a)].filter(Boolean).join(" · ")}
          // Остаток, а не итог — у обоих списков:
          // плитка «Ожидается» складывает остатки, и запись €100 с
          // предоплатой €30 стояла строкой €100 под плиткой €70.
          amount={getDebtAmount(a)}
          color={view === "debt" ? t.warning : t.sub}
          separated={i > 0}
          onPress={() => openRecord(a.id)}
        />
      ))}
      {listTx.map((tx, i) =>
        swipeTx(
          tx.id,
          tx,
          <TxRow
            key={tx.id}
            context={rowContext(tx)}
            title={rowTitle(tx)}
            amount={tx.amount}
            outflow={tx.type === "expense" || tx.type === "refund"}
            separated={i > 0}
            onPress={rowAction(tx)}
          />,
        ),
      )}
      {listExtras.map((e, i) => {
        const row = (
          <TxRow
            context="Ручная операция"
            title={e.name}
            amount={e.amount}
            outflow={e.kind === "expense"}
            separated={i > 0 || listTx.length > 0 || (view === "all" && dayPlan.length > 0)}
          />
        );
        // УДАЛЕНИЕ — СВАЙПОМ, ПРАВОЙ КРОМКОЙ (канон 9):
        // крестик в строке был четвёртым способом удалить что-то в
        // продукте и мишенью 36pt рядом с суммой.
        // Стирает строку своей стороны: сервер пишет только её, а чужую
        // сторону дня оставляет как была Старые строки
        // `replace_day_extras` пускает правами «Финансов», а не
        // «Доходом и расходом дня» — кнопка спрашивает то же.
        return teamId && writesLegacySide(e.kind) ? (
          <SwipeRow
            key={e.id}
            label="Удалить"
            color={t.danger}
            onAction={() => askRemoveLegacy(e)}
            accessibilityLabel={`Удалить «${e.name}»`}
          >
            {row}
          </SwipeRow>
        ) : (
          <View key={e.id}>{row}</View>
        );
      })}
    </RowGroup>
  );
}
