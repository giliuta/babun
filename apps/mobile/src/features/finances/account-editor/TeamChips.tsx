import { View } from "react-native";
import { Chip } from "@/components/ui/Chip";
import type { Team } from "@/features/reference/queries";

// ЧЕЙ СЧЁТ — ПИЛЮЛИ КОМАНД, одни на создание и правку. Тот же контрол, которым
// команду выбирают во всём продукте: свой цвет у каждой, `radio` (выбор один).
//
// В листе правки это не строка-дверь с вопросом, как было на странице
// настроек: вопрос рисует хост приложения, а лист — отдельное окно `Modal`, и
// из открытого листа iOS его не покажет («already presenting»). Пилюли
// отвечают на месте.
export function TeamChips({
  teams,
  selectedId,
  onSelect,
  disabled,
}: {
  teams: readonly Team[];
  selectedId: string | null;
  onSelect: (teamId: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {teams.map((team) => (
        <Chip
          key={team.id}
          label={team.name}
          color={team.color ?? undefined}
          selected={selectedId === team.id}
          radio
          disabled={disabled}
          onPress={() => onSelect(team.id)}
        />
      ))}
    </View>
  );
}
