import { useMemo } from "react";
import { Text } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { todayYMD } from "@/features/clients/filter";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { useTeams } from "@/features/reference/queries";
import { VisitRow, visitTeamName } from "@/features/clients/VisitRow";
import { useThemeColors } from "@/theme/colors";

// МАЛЕНЬКАЯ КАРТОЧКА ПОД НОМЕРОМ (владелец 2026-07-26). Не строки-факты, а
// сводка: долг первым и янтарём («обрати внимание», не авария), напоминание,
// и одной строкой доверие — визиты, сумма, когда был, когда записан.
// Отдельной карточкой, а не хвостом блока идентичности: это ПРОИЗВОДНОЕ, а не
// поле, которое правят.
//
// Она же — ВХОД В ИСТОРИЮ ЗАПИСЕЙ (владелец 2026-08-02). Отдельной строки
// «История записей · N» больше нет: она повторяла те же визиты числом, а
// место на карточке не бесконечное.
//
// Жила внутри `ClientHeader`; вынесена 2026-09-21 (STORY-085), когда шапке
// понадобился выбор «Человек / Компания», а файл уже был за 650 строк.
//
// ТОЛЬКО ПОСЛЕДНЯЯ ЗАПИСЬ (владелец 03.10: «убрать кнопку „Записать“; в
// истории высвечивается последняя запись — тап открывает страницу со всеми
// записями»; затем: «не надо в истории писать долг и так далее — просто как
// показано внутри, последняя запись и всё»). Блок — одна строка `VisitRow`,
// та же, что в «Истории»: дата, команда, состояние. Строки «Долг» и
// «Напомнить» здесь больше нет.

export function ClientSummaryCard({
  lastRecord,
  onOpenHistory,
  showMoney,
}: {
  /** Последняя запись клиента (`lastClientRecord`); `null` — записей нет. */
  lastRecord: Appointment | null;
  /** Право «Долг и деньги» у этого клиента (30.09); нет — `caps.money`. */
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
    // Записей нет — словами, без кнопки (владелец 15.09).
    return (
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: t.sub, paddingHorizontal: 16, paddingVertical: 12 }}>
        Записей пока нет
      </Text>
    );
  }
  return (
    <VisitRow
      appointment={lastRecord}
      team={visitTeamName(lastRecord.team_id, teamsById)}
      today={todayYMD()}
      showMoney={money}
      onPress={onOpenHistory}
    />
  );
}
