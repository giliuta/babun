import type { ReactElement } from "react";
import { View } from "react-native";
import { getDebtAmount, type Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { RowGroupHeader } from "@/components/ui/card-rows";
import { SELECT_SIDE } from "@/components/ui/select-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { humanDayYear } from "@/features/appointments/helpers";
import { RecordRowView } from "@/features/finances/RecordRow";
import type { RecordRow as FeedRow } from "@/features/finances/record-rows";
import { useThemeColors } from "@/theme/colors";
import type { LucideIcon } from "lucide-react-native";
import { HandCoins, CalendarClock } from "lucide-react-native";
import { dayExtraRow, dayTxTone } from "./day-rows";
import { RecordRow } from "./rows";
import type { DayView } from "./types";

export type RecordStatus = {
  word: string;
  amount: number;
  color: string;
  icon: LucideIcon;
  /** Подпись под суммой — как у такой же строки ленты (возраст долга). */
  caption?: string;
};

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
  serviceNames,
  recordStatus,
  debtCaption,
  openRecord,
  swipeTx,
  txRow,
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
  serviceNames: (a: Appointment) => string[];
  recordStatus: (a: Appointment) => RecordStatus;
  /** Возраст долга записи — подпись под суммой, как в ленте. */
  debtCaption: (a: Appointment) => string;
  openRecord: (appointmentId: string) => void;
  swipeTx: (key: string, tx: FinanceTransaction, row: ReactElement) => ReactElement;
  /** Строка ленты «Финансов» для операции (`dayTxRow`). */
  txRow: (tx: FinanceTransaction) => FeedRow | null;
  rowAction: (tx: FinanceTransaction) => (() => void) | undefined;
  writesLegacySide: (side: "income" | "expense") => boolean;
  askRemoveLegacy: (e: DayExtra) => void;
}) {
  const t = useThemeColors();
  // Операция — строкой ленты «Финансов», той же функцией: один заголовок,
  // одна подпись, один цвет.
  const txView = (key: string, tx: FinanceTransaction) => {
    const row = txRow(tx);
    if (!row) return null;
    return swipeTx(
      key,
      tx,
      <RecordRowView key={key} row={{ ...row, key }} tone={dayTxTone(tx)} onPress={rowAction(tx)} />,
    );
  };
  return listLoading ? (
    <EmptyState state="loading" />
  ) : listEmpty ? null : (
    // ПЛАШКИ С ВОЗДУХОМ, КАК В ЛЕНТЕ «ФИНАНСОВ», а не строки одной карточки:
    // та же операция обязана выглядеть одинаково в обоих местах.
    <View>
      <RowGroupHeader title={humanDayYear(ymd)} />
      <View style={{ paddingHorizontal: SELECT_SIDE, gap: 8 }}>
        {view === "all"
          ? dayPlan.map((item) => {
              if (item.record) {
                const status = recordStatus(item.record);
                return (
                  <RecordRow
                    key={item.key}
                    name={clientName(item.record)}
                    time={item.record.time_start?.slice(0, 5) || null}
                    services={serviceNames(item.record)}
                    amount={status.amount}
                    color={status.color}
                    status={status.word}
                    caption={status.caption}
                    icon={status.icon}
                    onPress={() => openRecord(item.record!.id)}
                  />
                );
              }
              return item.tx ? txView(item.key, item.tx) : null;
            })
          : null}
        {listRecords.map((a) => (
          <RecordRow
            key={a.id}
            name={clientName(a)}
            time={a.time_start?.slice(0, 5) || null}
            services={serviceNames(a)}
            // Остаток, а не итог — у обоих списков:
            // плитка «Ожидается» складывает остатки, и запись €100 с
            // предоплатой €30 стояла строкой €100 под плиткой €70.
            amount={getDebtAmount(a)}
            color={view === "debt" ? t.warning : t.sub}
            caption={view === "debt" ? debtCaption(a) : undefined}
            icon={view === "debt" ? HandCoins : CalendarClock}
            onPress={() => openRecord(a.id)}
          />
        ))}
        {listTx.map((tx) => txView(tx.id, tx))}
        {listExtras.map((e) => {
          const row = <RecordRowView row={dayExtraRow(e, ymd)} tone={e.kind} />;
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
              radius={t.radius.input}
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
      </View>
    </View>
  );
}
