import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { todayYMD } from "@/features/clients/filter";
import { useClientsCapabilities } from "@/session/company-scope";
import { useTeams } from "@/features/reference/queries";
import { VisitDayHeader, VisitRow } from "@/features/clients/VisitRow";

import { useThemeColors } from "@/theme/colors";

// МАЛЕНЬКАЯ КАРТОЧКА ПОД НОМЕРОМ. Не строки-факты, а
// сводка: долг первым и янтарём («обрати внимание», не авария), напоминание,
// и одной строкой доверие — визиты, сумма, когда был, когда записан.
// Отдельной карточкой, а не хвостом блока идентичности: это ПРОИЗВОДНОЕ, а не
// поле, которое правят.
//
// Она же — ВХОД В ИСТОРИЮ ЗАПИСЕЙ. Отдельной строки «История записей · N»
// нет: она повторяла бы те же визиты числом, а место на карточке не
// бесконечное.
//
// Вынесена из `ClientHeader` (STORY-085), чтобы файл шапки не перерос лимит.
//
// ТОЛЬКО ПОСЛЕДНЯЯ ЗАПИСЬ: в истории высвечивается последняя запись, тап
// открывает страницу со всеми записями; долг и прочее в истории не пишем.
// Блок — одна строка `VisitRow`, та же, что в «Истории»: дата, команда,
// состояние. Строк «Долг» и «Напомнить» здесь нет.

export function ClientSummaryCard({
  lastRecord,
  onOpenHistory,
  showMoney,
}: {
  /** Последняя запись клиента (`lastClientRecord`); `null` — записей нет. */
  lastRecord: Appointment | null;
  /** Деньги этого клиента идут вместе с «Историей»; нет — `caps.money`. */
  showMoney?: boolean;
  /** Открыть историю записей. Не задан — строка показание, без перехода. */
  onOpenHistory?: () => void;
}) {
  const t = useThemeColors();
  // Справочник с архивом — назвать команду и архивного визита; ключ общий с
  // календарём и историей, сети не прибавляет.
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = useMemo(() => new Map(allTeams.map((team) => [team.id, team])), [allTeams]);
  // ДЕНЬГИ КЛИЕНТА — ТОЛЬКО ТОМУ, КОМУ ОНИ ОТКРЫТЫ (STORY-088, волна 4).
  const capsMoney = useClientsCapabilities().money;
  const money = showMoney ?? capsMoney;

  if (!lastRecord) {
    // Записей нет — словами, без кнопки.
    return (
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: t.sub, paddingHorizontal: 16, paddingVertical: 12 }}>
        Записей пока нет
      </Text>
    );
  }
  return (
    // Тот же день и та же плашка, что в «Истории». Внутри блока плашка без
    // боковых полей списка: плитка встаёт на одну линию с датой над ней
    // (иначе иконка выглядит съехавшей вправо).
    <>
      <VisitDayHeader date={lastRecord.date} />
      <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
      <VisitRow
        appointment={lastRecord}
        team={lastRecord.team_id ? teamsById.get(lastRecord.team_id) : undefined}
        today={todayYMD()}
        showMoney={money}
        onPress={onOpenHistory}
      />
      </View>
    </>
  );
}
