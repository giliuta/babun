import { useRef } from "react";
import { ScrollView, View } from "react-native";
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
  const scrollRef = useRef<ScrollView>(null);
  // Персистированная команда может оказаться за правым краем — один раз
  // после layout подскролливаем к её чипу (без анимации: это первый кадр).
  const didAutoScroll = useRef(false);
  if (teams.length === 0) return null;
  return (
    <ScrollView
      ref={scrollRef}
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
      {teams.map((tm) => {
        const active = activeId === tm.id;
        return (
          <View
            key={tm.id}
            onLayout={
              active && !didAutoScroll.current
                ? (e) => {
                    didAutoScroll.current = true;
                    scrollRef.current?.scrollTo({
                      x: Math.max(0, e.nativeEvent.layout.x - 16),
                      animated: false,
                    });
                  }
                : undefined
            }
          >
            <Chip
              label={tm.name}
              variant="outline"
              color={tm.color || undefined}
              radio
              selected={active}
              onPress={() => onSelect(tm.id)}
              style={{ maxWidth: 180 }}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}
