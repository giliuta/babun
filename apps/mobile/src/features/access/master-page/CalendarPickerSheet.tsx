import { View } from "react-native";
import { CalendarRange } from "lucide-react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { SELECT_SHEET_RATIO, SelectList, SelectRow } from "@/components/ui/select-rows";
import type { Team } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useCalendarVisibility } from "@/session/workspaces";
import { useTeamName } from "@/session/team-name";

// КАЛЕНДАРИ МАСТЕРА — ШТОРКА ВЫБОРА ПО КАНОНУ (`select-rows`), как теги у
// клиента: календарей может быть несколько, поэтому тап отмечает строку, а
// закрывает шторку «Применить». Строка несёт цвет календаря — тот же, что у
// его чипа в ленте над календарём.

export function CalendarPickerSheet({
  visible,
  teams,
  selected,
  onToggle,
  onClose,
  onExited,
}: {
  visible: boolean;
  /** Живые календари компании. */
  teams: readonly Team[];
  selected: readonly string[];
  onToggle: (teamId: string) => void;
  onClose: () => void;
  /** Лист уехал и его окно снято — отсюда можно поднимать следующий. */
  onExited?: () => void;
}) {
  // СКРЫТЫЙ КАЛЕНДАРЬ ВЛАДЕЛЬЦА («My») В ВЫБОРЕ НЕ СТОИТ: человек его нигде,
  // кроме шестерёнки, не видит. Уже выбранный остаётся — снять его можно.
  const { isHidden } = useCalendarVisibility();
  // Команда, названная почтой, — именем, как в ленте календаря.
  const teamName = useTeamName();
  const shown = teams.filter((team) => !isHidden(team.tenant_id, team.id) || selected.includes(team.id));
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onExited={onExited}
      // «Команды» — тем же словом, что блок и «Добавить в команду».
      title="Команды"
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <SelectList>
        {shown.length > 0 ? (
          shown.map((team) => (
            <SelectRow
              key={team.id}
              icon={CalendarRange}
              title={teamName(team.name)}
              color={team.color ?? undefined}
              selected={selected.includes(team.id)}
              accessibilityRole="checkbox"
              onPress={() => {
                haptics.tap();
                onToggle(team.id);
              }}
            />
          ))
        ) : (
          <EmptyState title="Команд пока нет" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
