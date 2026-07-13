import { ScrollView } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";

export type ChipTeam = { id: string; name: string; color?: string | null };

// Web-parity team-calendar tabs (apps/web Header.tsx → TeamTabStrip): a
// horizontally-scrollable pill strip that SWITCHES the visible calendar
// between teams. Exactly one team is active at a time — there is no «all
// teams» view (web deliberately dropped the combined view). Active = filled
// team colour + white label; idle+colour = outline in the team hue; idle =
// separator-bordered.
export function TeamChips({
  teams,
  activeId,
  onSelect,
}: {
  teams: ChipTeam[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();
  if (teams.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Единственный шов под всем хромом шапки живёт здесь (CalendarHeader
      // своего borderBottom не имеет — иначе две линии подряд).
      style={{
        flexGrow: 0,
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
        alignItems: "center",
      }}
    >
      {teams.map((tm) => (
        <Chip
          key={tm.id}
          label={tm.name}
          variant="outline"
          color={tm.color || undefined}
          radio
          selected={activeId === tm.id}
          onPress={() => onSelect(tm.id)}
          style={{ maxWidth: 180 }}
        />
      ))}
    </ScrollView>
  );
}
