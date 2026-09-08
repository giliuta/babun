import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { PersonalEventType, PersonalEventTypeIcon } from "@babun/shared/local/personal-event-types";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/Field";
import { IconField, NameColorField } from "@/components/ui/picker-fields";
import { EVENT_TYPE_ICON_PRESETS } from "@/features/calendar/event-type-icons";
import { durationLabel } from "@/features/services/format";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ПРАВКА ТИПА СОБЫТИЯ — КАНОНИЧЕСКИЙ ЛИСТ, как «Новая метка» и «Услуга».
// Заведение и правка — один лист: поля у них одни и те же, а два разных окна
// расходятся на первой же правке (так уже разошлись две формы записи).
//
// Удаления здесь нет намеренно: оно живёт на кромке свайпа, а вопрос,
// заданный из листа, не показался бы вовсе (закон о двух окнах).

const DEFAULT_COLOR = PRESET_COLOR_CYCLE[1].value;
/** Длительности, которые набирают чаще всего. Поле рядом остаётся: обед на
 *  25 минут — законное число, и решётка не должна его запрещать. */
const QUICK_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240];

export interface EventTypeDraft {
  label: string;
  color: string;
  icon: PersonalEventTypeIcon;
  allDay: boolean;
  /** Минуты; при `allDay` не читается. */
  duration: number;
}

export function EventTypeSheet({
  visible,
  type,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** Правим этот тип; `null` — заводим новый. */
  type: PersonalEventType | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: EventTypeDraft) => void;
}) {
  const t = useThemeColors();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<PersonalEventTypeIcon>("tag");
  const [allDay, setAllDay] = useState(false);
  const [minutes, setMinutes] = useState("60");
  // Черновик берётся у той строки, которую открыли, и ровно один раз: пока
  // лист открыт, значениями владеют поля.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = !visible ? null : type ? type.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setLabel(type?.label ?? "");
    setColor(type?.color ?? DEFAULT_COLOR);
    setIcon(type?.icon ?? "tag");
    setAllDay(type?.allDay ?? false);
    setMinutes(String(type?.defaultDuration ?? 60));
  }

  const parsed = Math.max(5, Math.min(24 * 60, Number(minutes) || 60));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={type ? "Тип события" : "Новый тип"}
      avoidKeyboard
      scroll
      footer={
        <Button
          label={type ? "Сохранить" : "Создать"}
          onPress={() =>
            onSubmit({ label, color, icon, allDay, duration: parsed })
          }
          disabled={!label.trim() || busy}
          loading={busy}
        />
      }
    >
      {/* Имя и цвет одной строкой — тот же блок, что у услуги, метки и тега. */}
      <NameColorField
        name={label}
        onNameChange={setLabel}
        color={color}
        onColorChange={setColor}
        autoFocus={!type}
      />
      <IconField
        value={icon}
        onChange={(slug) => setIcon(slug as PersonalEventTypeIcon)}
        tint={color}
        icons={EVENT_TYPE_ICON_PRESETS}
      />

      {/* СВОЁ ВРЕМЯ У КАЖДОГО ТИПА (владелец 2026-09-08: «на каждом типе
          событий нужно выставлять своё время: выбираю обед — оно
          автоматически подстраивает время»). Это СТАНДАРТ: время, выбранное
          в самом событии руками, сильнее — так и написано под лентой типов. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 6,
        }}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, color: t.ink }}>
          Весь день
        </Text>
        <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: t.accent }} />
      </View>

      {!allDay ? (
        <>
          <Field
            label="Длительность, мин"
            value={minutes}
            onChangeText={setMinutes}
            placeholder="60"
            keyboardType="number-pad"
            trailing={
              <Text style={{ fontSize: 13, color: t.sub }}>
                {durationLabel(parsed)}
              </Text>
            }
          />
          <FieldLabel text="Чаще всего" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {QUICK_MINUTES.map((value) => {
              const on = parsed === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    haptics.tap();
                    setMinutes(String(value));
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={durationLabel(value)}
                  style={({ pressed }) => ({
                    minHeight: 34,
                    justifyContent: "center",
                    paddingHorizontal: 12,
                    borderRadius: t.radius.pill,
                    backgroundColor: on ? color : pressed ? t.pressed : t.rowFill,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "500",
                      color: on ? "#fff" : t.body,
                    }}
                  >
                    {durationLabel(value)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}
