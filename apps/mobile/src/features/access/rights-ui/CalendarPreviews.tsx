import { Text, View } from "react-native";
import { Bookmark, Trash2 } from "lucide-react-native";

import { Card } from "@/components/ui/Card";
import { NavRow } from "@/components/ui/card-rows";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { PRESET_COLOR_VALUES } from "@babun/shared/common/utils/colors";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ICON } from "@/components/ui/tokens";
import { actionLook } from "@/features/calendar/ActionMenuSheet";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { previewActions, previewRecord, sampleTile, type SampleTile } from "./preview-sample";

// ВИД ПРАВ КАЛЕНДАРЯ В ШТОРКЕ: кусок сетки дня с записью и свободным
// временем, меню записи по долгому нажатию, метка над днём, график. Что есть
// и что можно — считает `calendarActions`, то же правило, что у календаря
// сотрудника.

const noop = () => {};


const HOUR = 46;

/** Кусок сетки дня: запись в 10:00, свободный час, событие в 12:00. */
function DayGrid({
  color,
  tile,
  free,
  event,
}: {
  color: string;
  /** Подпись записи — с тем, что из неё видно (`sampleTile`). */
  tile: SampleTile;
  /** Подпись свободного часа, по которому можно создать; нет — час пустой. */
  free?: string;
  event?: "read" | "write";
}) {
  const t = useThemeColors();
  const hours = ["10:00", "11:00", "12:00"];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 6 }}>
      {hours.map((hour, i) => (
        <View key={hour} style={{ flexDirection: "row", height: HOUR }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ width: 52, paddingLeft: 12, paddingTop: 2, fontSize: 12, color: t.faint, fontVariant: ["tabular-nums"] }}
          >
            {hour}
          </Text>
          <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: t.separator, paddingRight: 10, paddingVertical: 4 }}>
            {i === 0 ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: `${color}2e`,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.ink }}>
                  {tile.title}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 11, color: t.sub }}>
                  {tile.sub}
                </Text>
              </View>
            ) : null}
            {i === 1 && free ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  {free}
                </Text>
              </View>
            ) : null}
            {i === 2 && event ? (
              <View
                style={{
                  height: HOUR / 2,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: t.fill,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.body }}>
                  Обед · 12:00–12:30
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** Запись и меню по долгому нажатию на неё — пункты тем же видом, что в
 *  меню календаря (`actionLook`). */
export function AppointmentMenuPreview({
  color,
  tile,
  items,
  swatches,
}: {
  color: string;
  tile: SampleTile;
  items: readonly string[];
  /** Строка цветов под пунктом «Цвет». */
  swatches?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View>
      <DayGrid color={color} tile={tile} />
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
        <SelectList>
          {items.map((label) => {
            const look = actionLook(label);
            return (
              <SelectRow
                key={label}
                title={label}
                icon={look?.icon ?? Trash2}
                color={look?.color ?? t.danger}
                onPress={noop}
              />
            );
          })}
        </SelectList>
        {swatches ? (
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 }}>
            {PRESET_COLOR_VALUES.slice(0, 7).map((swatch) => (
              <View key={swatch} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: swatch }} />
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** Три дня недели и метка над первым. */
function DayLabelPreview({ write }: { write: boolean }) {
  const t = useThemeColors();
  const days = [
    { dow: "ПН", day: "29" },
    { dow: "ВТ", day: "30" },
    { dow: "СР", day: "1" },
  ];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, flexDirection: "row", paddingVertical: 10 }}>
      {days.map((d, i) => (
        <View key={d.day} style={{ flex: 1, alignItems: "center", gap: 4 }}>
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: "600", color: t.faint }}>
            {d.dow}
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 20, fontWeight: "700", color: t.ink }}>
            {d.day}
          </Text>
          {i === 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: t.radius.pill,
                backgroundColor: `${SETTINGS_TILE.teal}24`,
                borderWidth: write ? 1 : 0,
                borderColor: SETTINGS_TILE.teal,
              }}
            >
              <Bookmark color={SETTINGS_TILE.teal} size={ICON.xs} strokeWidth={2.2} />
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: SETTINGS_TILE.teal }}>
                Лимассол
              </Text>
            </View>
          ) : (
            <View style={{ height: 22 }} />
          )}
        </View>
      ))}
    </Card>
  );
}

export function CalendarPreview({
  blockKey,
  blocks,
  levels,
  teamColor,
}: {
  blockKey: string;
  blocks: readonly AccessBlock[];
  levels: Readonly<Record<string, AccessLevel>>;
  teamColor: string;
}) {
  const actions = previewActions(blocks, levels);
  const tile = sampleTile(previewRecord(blocks, levels));
  // Событие на сетке — если он их видит: сетка в шторке та же, что у него.
  const seenEvent = actions.events === "hidden" ? undefined : actions.events;
  switch (blockKey) {
    case "calendar.create":
      return (
        <PreviewFrame state={actions.create ? "can" : "cannot"}>
          <DayGrid color={teamColor} tile={tile} free="Новая запись" event={seenEvent} />
        </PreviewFrame>
      );
    case "calendar.move":
      return (
        <PreviewFrame state={actions.move ? "can" : "cannot"}>
          <AppointmentMenuPreview color={teamColor} tile={tile} items={["Перенести", "Копировать"]} />
        </PreviewFrame>
      );
    case "calendar.cancel":
      return (
        <PreviewFrame state={actions.cancel ? "can" : "cannot"}>
          <AppointmentMenuPreview color={teamColor} tile={tile} items={["Отменить визит", "Удалить"]} />
        </PreviewFrame>
      );
    case "calendar.events":
      return (
        <PreviewFrame state={levelState(actions.events)}>
          <DayGrid
            color={teamColor}
            tile={tile}
            event={actions.events === "write" ? "write" : "read"}
            free={actions.events === "write" ? "Новое событие" : undefined}
          />
        </PreviewFrame>
      );
    case "calendar.day_labels":
      return (
        <PreviewFrame state={levelState(actions.dayLabels)}>
          <DayLabelPreview write={actions.dayLabels === "write"} />
        </PreviewFrame>
      );
    case "calendar.schedule":
      return (
        <PreviewFrame state={levelState(actions.schedule)}>
          <Card style={{ marginHorizontal: 16, marginTop: 8 }}>
            <NavRow
              label="График команды"
              value="Пн–Пт · 9:00–18:00"
              onPress={actions.schedule === "write" ? noop : undefined}
            />
          </Card>
        </PreviewFrame>
      );
    default:
      return null;
  }
}
