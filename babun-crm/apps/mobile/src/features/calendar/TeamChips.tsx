import { ScrollView } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";

export type ChipTeam = { id: string; name: string; color?: string | null };

// Web-parity brigade tabs: horizontal pills. Active = filled team colour + white
// label; idle+colour = outline in the brigade hue; idle = separator-bordered.
export function TeamChips({
  teams,
  activeId,
  onSelect,
}: {
  teams: ChipTeam[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useThemeColors();
  if (teams.length === 0) return null;
  const all: ChipTeam[] = [{ id: "__all__", name: "Все", color: null }, ...teams];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, backgroundColor: t.surface }}
      contentContainerStyle={{
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 7,
        gap: 8,
        alignItems: "center",
      }}
    >
      {all.map((tm) => {
        const id = tm.id === "__all__" ? null : tm.id;
        return (
          <Chip
            key={tm.id}
            label={tm.name}
            variant="outline"
            color={tm.color || undefined}
            radio
            selected={activeId === id}
            onPress={() => onSelect(id)}
            style={{ maxWidth: 180 }}
          />
        );
      })}
    </ScrollView>
  );
}
