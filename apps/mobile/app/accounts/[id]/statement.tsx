import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { GUTTER } from "@/components/ui/tokens";
import { notify } from "@/lib/notify";
import { accountEditHref } from "@/features/finances/account-editor/editor-logic";
import { PeriodRow } from "@/features/finances/FinanceOverview";
import { PeriodPresetModal, PeriodWheelsModal } from "@/features/finances/PeriodSheets";
import {
  defaultPeriod,
  dmyShort,
  periodDates,
  periodTitle,
  type Period,
} from "@/features/finances/period";
import { todayYmd } from "@/features/invoices/format";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { StatementPaper } from "@/features/finances/statement/StatementPaper";
import { shareStatementPdf } from "@/features/finances/statement/statement-pdf";
import { useStatementDocument } from "@/features/finances/statement/use-statement";

// ВЫПИСКА СЧЁТА — СНАЧАЛА ЛИСТ, ПОТОМ ФАЙЛ (владелец 03.10: «когда выписка
// делается, то сначала создаётся превью файла, а потом уже можно только
// передавать это»). Открывается строкой «Выписка» в листе счёта; «назад»
// возвращает в тот же лист. На экране — та же бумага, что уйдёт PDF-файлом;
// действие страницы одно — «Поделиться PDF» в футере.
//
// ЗА ПЕРИОД (владелец 03.10: «выписка за период — прям хорошо»): под шапкой
// тот же ряд периода, что на «Финансах» — имя открывает готовые периоды
// (месяц, квартал — VAT на Кипре сдаётся поквартально, год), даты — свои.
// Сверху списка готовых — «Всё время». Открывается на текущем месяце, как
// «Финансы»; остаток на начало — к первому дню периода.
export default function AccountStatementRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const timeZone = useCalendarSettings().data?.timezone;
  const businessNow = timeZone ? getCurrentTimeInZone(timeZone) : getCurrentCyprusTime();
  const today = todayYmd(timeZone ?? "Europe/Nicosia");
  /** `null` — всё время. */
  const [period, setPeriod] = useState<Period | null>(() => defaultPeriod(businessNow));
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const statement = useStatementDocument(id, period ? { from: period.from, to: period.to } : null);
  const [sharing, setSharing] = useState(false);

  // «Всё время» — от первой операции счёта до сегодня (у пустого — сегодня).
  const allFrom = statement.firstDay ?? today;
  const shownPeriod: Period = period ?? { preset: "custom", from: allFrom, to: today };

  const share = async () => {
    if (!statement.doc || sharing) return;
    setSharing(true);
    try {
      await shareStatementPdf(statement.doc);
    } catch (e) {
      notify("Не удалось поделиться выпиской", e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Выписка"
        seam={false}
        fallbackHref={id ? accountEditHref(id) : undefined}
      />
      <PeriodRow
        title={period ? periodTitle(period) : "Всё время"}
        dates={periodDates(shownPeriod)}
        onOpenPresets={() => setPresetsOpen(true)}
        onOpenCustom={() => setWheelsOpen(true)}
      />
      {statement.doc ? (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: GUTTER, paddingBottom: 24 }}>
          <StatementPaper doc={statement.doc} />
        </ScrollView>
      ) : statement.error ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось собрать выписку"
          subtitle={statement.error instanceof Error ? statement.error.message : undefined}
          action={{ label: "Повторить", onPress: statement.refetch }}
        />
      ) : statement.loading ? (
        <EmptyState state="loading" fill title="Собираем выписку" />
      ) : (
        <EmptyState fill title="Счёт не найден" />
      )}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="Поделиться PDF"
          loading={sharing}
          disabled={!statement.doc}
          onPress={() => void share()}
        />
      </View>

      <PeriodPresetModal
        visible={presetsOpen}
        current={period}
        businessNow={businessNow}
        allTime={{
          active: period === null,
          hint: `${dmyShort(allFrom)} – ${dmyShort(today)}`,
          onSelect: () => setPeriod(null),
        }}
        onClose={() => setPresetsOpen(false)}
        onApply={setPeriod}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={shownPeriod}
        onClose={() => setWheelsOpen(false)}
        onApply={setPeriod}
      />
    </Screen>
  );
}
