import { View } from "react-native";
import { CalendarRange } from "lucide-react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { SELECT_SHEET_RATIO, SelectList, SelectRow } from "@/components/ui/select-rows";
import type { Team } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";

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
}: {
  visible: boolean;
  /** Живые календари компании. */
  teams: readonly Team[];
  selected: readonly string[];
  onToggle: (teamId: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Календари"
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <SelectList>
        {teams.length > 0 ? (
          teams.map((team) => (
            <SelectRow
              key={team.id}
              icon={CalendarRange}
              title={team.name}
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
          <EmptyState title="В компании пока нет календарей" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
