import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";

// Чек-лист команд общего счёта: строка «Все команды» — мастер-галка,
// дальше по строке на команду (галка = выбор, как в попапах фильтров).
export function TeamChecklist({
  teams,
  selected,
  onToggle,
  onToggleAll,
}: {
  teams: Team[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll?: () => void;
}) {
  const t = useThemeColors();
  const allSelected = teams.length > 0 && teams.every((x) => selected.has(x.id));
  const row = (
    key: string,
    label: string,
    isSelected: boolean,
    onPress: () => void,
    color?: string | null,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={label}
      className="flex-row items-center gap-3 active:opacity-60"
      style={{ minHeight: 44 }}
    >
      {color !== undefined ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color || t.accent,
          }}
        />
      ) : null}
      <Text
        className="flex-1 text-[15px] font-medium"
        style={{ color: t.ink }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {isSelected ? <Check color={t.accent} size={18} strokeWidth={2.6} /> : null}
    </Pressable>
  );

  return (
    <View className="mb-1">
      {onToggleAll ? row("all", "Все команды", allSelected, onToggleAll) : null}
      {teams.map((team) =>
        row(
          team.id,
          team.name,
          selected.has(team.id),
          () => onToggle(team.id),
          team.color ?? null,
        ),
      )}
    </View>
  );
}
