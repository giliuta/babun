import { useMemo } from "react";
import { SectionList, Text, View, type RefreshControlProps } from "react-native";
import type { ReactElement, ReactNode } from "react";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { PanelHeader } from "./PanelHeader";
import { RecordRowView, type RecordRowTone } from "./RecordRow";
import type { RecordRow } from "./record-rows";

// РАЗРЕЗ ДЕНЕГ РАСКРЫВАЕТСЯ НА МЕСТЕ, ПОД ПЛИТКАМИ (владелец 2026-09-09:
// «не надо делать вообще отдельную страницу — оно должно быть внизу, под
// этими блоками»). Это его же закон от 2026-08-11: страница — только для
// того, чем управляют; то, на что смотрят, раскрывается на месте.
//
// От ленты операций панель отличается ЕДИНИЦЕЙ: там строка — проводка, здесь
// строка — визит. Оболочка та же самая (эйбрау, дни с итогом, швы), потому
// что панели экрана обязаны быть ровесниками, а не соседями по случайности.

export function RecordRowsPanel({
  rows,
  title,
  tone,
  emptyTitle,
  emptySubtitle,
  emptyAction,
  headerRight,
  countEveryTone,
  onReset,
  refreshControl,
  onOpenRecord,
}: {
  rows: RecordRow[];
  title: string;
  /** Направление списка. У смешанной ленты его нет — там каждая строка
   *  приносит своё (`row.tone`). */
  tone?: RecordRowTone;
  emptyTitle?: string;
  emptySubtitle?: string;
  emptyAction?: { label: string; onPress: () => void };
  /** Что стоит справа в эйбрау (кнопки сторон у долгов). */
  headerRight?: ReactNode;
  /** ИТОГ ДНЯ СКЛАДЫВАЕТ ВСЕ СТРОКИ, а не только движение денег. Нужен
   *  однородному списку: в разрезе «Долги» каждая строка — долг, и без этого
   *  над каждым днём стоял бы ноль. В смешанной ленте наоборот: долг ещё не
   *  пришёл, перевод переехал между своими счетами, и складывать их с доходом
   *  значит печатать числа, которые не значат ничего. */
  countEveryTone?: boolean;
  /** «Все» в эйбрау — возврат к полной ленте. */
  onReset?: () => void;
  refreshControl?: ReactElement<RefreshControlProps>;
  onOpenRecord: (row: RecordRow) => void;
}) {
  const t = useThemeColors();

  const sections = useMemo(() => {
    const byDay = new Map<string, RecordRow[]>();
    for (const row of rows) {
      const day = byDay.get(row.date);
      if (day) day.push(row);
      else byDay.set(row.date, [row]);
    }
    return [...byDay.entries()].map(([date, data]) => ({
      title: date,
      // ИТОГ ДНЯ СЧИТАЕТ ТОЛЬКО ПРИШЕДШЕЕ И УШЕДШЕЕ. Долг ещё не пришёл, а
      // перевод переехал между своими счетами — в компании денег от него не
      // прибавилось. Сложенные с доходом, они давали числа, которые не значат
      // ничего: «€185» при 128 в кассе, «€55» в день без единой продажи.
      net: data.reduce(
        (sum, row) =>
          !countEveryTone && (row.tone === "debt" || row.tone === "transfer")
            ? sum
            : sum + row.amount,
        0,
      ),
      data,
    }));
  }, [rows, countEveryTone]);

  const sectionHeader = (section: { title: string; net: number }) => {
    // Ноль движения — не приход: цвет здесь означает направление денег, а у
    // нуля направления нет (тот же закон, что в ленте операций).
    const netSign = moneySign(section.net);
    // У ОДНОРОДНОГО СПИСКА ЦВЕТ ДАЁТ ЕГО ТОН, а не знак суммы. В разрезе
    // «Долги» все строки янтарные, а итог дня печатался зелёным — числом
    // прихода, которого не было: €195 долга не деньги в кассе.
    const dayColor =
      countEveryTone && tone
        ? tone === "income"
          ? t.success
          : tone === "debt"
            ? t.warning
            : tone === "transfer"
              ? t.sub
              : t.danger
        : netSign < 0
          ? t.danger
          : netSign > 0
            ? t.success
            : t.sub;
    return (
      <View
        className="flex-row items-center justify-between px-4 py-1.5"
        style={{ backgroundColor: t.canvas }}
      >
        <Text
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.sub }}
        >
          {humanDay(section.title)}
        </Text>
        <Text
          className="text-xs font-semibold"
          style={{ color: dayColor, fontVariant: ["tabular-nums"] }}
        >
          {formatEUR(section.net)}
        </Text>
      </View>
    );
  };

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      refreshControl={refreshControl}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={
        <PanelHeader title={title} right={headerRight} onReset={onReset} />
      }
      ListEmptyComponent={
        <EmptyState
          title={emptyTitle ?? "Нет записей за период"}
          subtitle={emptySubtitle}
          action={emptyAction}
        />
      }
      contentContainerStyle={{ paddingBottom: 96 }}
      renderSectionHeader={({ section }) => sectionHeader(section)}
      renderItem={({ item }) => (
        <RecordRowView
          row={item}
          tone={item.tone ?? tone ?? "income"}
          // НАЖИМАЕТСЯ ВСЁ, У ЧЕГО ЕСТЬ ДВЕРЬ, а не только записи. Условие
          // было `item.appointmentId`, и строка без визита — бензин, обед,
          // перевод, ручной долг — не нажималась вовсе: обработчик экрана их
          // ждал и умел открыть, но нажатие до него не доходило. Другой двери
          // к правке одиночной операции на экране нет.
          onPress={
            item.appointmentId || item.txId || item.debtId
              ? () => onOpenRecord(item)
              : undefined
          }
        />
      )}
      ItemSeparatorComponent={() => (
        <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
      )}
      keyboardShouldPersistTaps="handled"
    />
  );
}
