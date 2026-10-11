import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ReorderList } from "@/components/ui/ReorderList";
import { RowCaption } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useTeams } from "@/features/reference/queries";
import { calendarOrderKey } from "@/features/settings/calendar-chips";
import { useSaveCalendarOrder } from "@/features/settings/use-calendar-order";
import { useCalendarChips } from "@/features/settings/workspaces";
import { useTenantId } from "@/lib/tenant";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

// ПОРЯДОК КАЛЕНДАРЕЙ (владелец 11.10: «нужно, чтоб можно менять местами
// календари»). Те же календари, что в ленте шестерёнки (все аккаунты, и
// скрытые), в том же порядке; тянут за точки справа — общий `ReorderList`,
// как блоки «Записей», счета и способы связи. Порядок — человека
// (`user_calendar_order`): по нему стоят ленты календаря, финансов и
// шестерёнки на всех его устройствах. Страница открыта каждому: это его лента,
// а не настройка команды.

const ROW_H = 52;

export default function CalendarOrderScreen() {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const { data: teams = [] } = useTeams();
  const chips = useCalendarChips({
    own: teams,
    includeHidden: true,
    onPickOwn: () => {},
    onSwitchError: () => {},
  });
  const save = useSaveCalendarOrder();
  const [dragging, setDragging] = useState(false);

  const onReorder = (ids: string[]) => {
    const keys = ids
      .map((id) => calendarOrderKey(id, tenantId))
      .filter((key): key is string => key != null);
    save.mutate(keys, {
      onError: (e) => notify("Не удалось сохранить порядок", e.message),
    });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Порядок календарей" />
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard className="mt-4">
          <ReorderList
            items={chips.items}
            rowHeight={ROW_H}
            labelFor={(chip) => chip.name}
            onReorder={onReorder}
            onDraggingChange={setDragging}
          >
            {(chip) => (
              <View
                style={{
                  height: ROW_H,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingLeft: 16,
                }}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: chip.color || t.accent,
                  }}
                />
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ flex: 1, fontSize: 16, color: t.ink }}
                >
                  {chip.name}
                </Text>
              </View>
            )}
          </ReorderList>
        </SectionCard>
        <RowCaption text="Перетащите за точки справа. В таком порядке календари стоят в ленте календаря и финансов." />
      </ScrollView>
    </Screen>
  );
}
