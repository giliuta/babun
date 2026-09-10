import { useState } from "react";
import { View } from "react-native";
import type { PersonalEventType, PersonalEventTypeIcon } from "@babun/shared/local/personal-event-types";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/Field";
import { NameColorField } from "@/components/ui/picker-fields";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { eventTypeIconPresets } from "@/features/calendar/event-type-icons";

// ПРАВКА ТИПА СОБЫТИЯ — КАНОНИЧЕСКИЙ ЛИСТ, как «Новая метка» и «Услуга».
// Заведение и правка — один лист: поля у них одни и те же, а два разных окна
// расходятся на первой же правке (так уже разошлись две формы записи).
//
// Удаления здесь нет намеренно: оно живёт на кромке свайпа, а вопрос,
// заданный из листа, не показался бы вовсе (закон о двух окнах).

const DEFAULT_COLOR = PRESET_COLOR_CYCLE[1].value;
/** Меньше пяти минут события не бывает: шаг барабана и есть минимум. */
const MIN_DURATION = 5;

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
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<PersonalEventTypeIcon>("tag");
  const [allDay, setAllDay] = useState(false);
  const [duration, setDuration] = useState(60);
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
    setDuration(type?.defaultDuration ?? 60);
  }

  // Барабан свободно доезжает до 00:00 — на записи это чинится одним
  // сравнением, а не прыжком колеса из-под пальца.
  const parsed = Math.max(MIN_DURATION, Math.min(24 * 60, duration));

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
      {/* Имя, цвет и значок одной строкой — тот же блок, что у услуги, метки,
          тега и категории. Значок был отдельным полем со своей решёткой; с
          2026-09-10 цвет и значок — один вопрос и одна шторка. */}
      <NameColorField
        name={label}
        onNameChange={setLabel}
        color={color}
        onColorChange={setColor}
        icon={icon}
        onIconChange={(slug) => setIcon(slug as PersonalEventTypeIcon)}
        icons={eventTypeIconPresets(icon)}
        autoFocus={!type}
      />

      {/* СВОЁ ВРЕМЯ У КАЖДОГО ТИПА (владелец 2026-09-08: «на каждом типе
          событий нужно выставлять своё время: выбираю обед — оно
          автоматически подстраивает время»). Это СТАНДАРТ: время, выбранное
          в самом событии руками, сильнее — так и написано под лентой типов.

          СТРОКА, А НЕ ГОЛЫЙ ТУМБЛЕР (2026-09-10): здесь стоял `Switch` в
          самодельной строке, и тап по слову «Весь день» не переключал ничего
          — попасть надо было точно в тумблер. `SwitchRow` для этого и
          существует (LOCKED 2026-08-17). */}
      <SwitchRow label="Весь день" value={allDay} onChange={setAllDay} />

      {/* ДЛИТЕЛЬНОСТЬ — БАРАБАНОМ (владелец 2026-09-10: «барабан везде»).
          Здесь было поле «Длительность, мин» с цифровой клавиатурой и лента
          пресетов 15/30/45/60/90/120/180/240 — ровно то, что канон запрещает
          дословно: «любая продолжительность — TimeWheelPair; никаких
          пресетов, никаких полей ввода минут, никаких степперов». Подписи
          «ч» и «мин» под колонками обязательны: «00 : 30» без них читается
          как полпервого ночи. */}
      {!allDay ? (
        <View style={{ paddingTop: 8, paddingBottom: 12 }}>
          <FieldLabel text="Длительность" />
          <TimeWheelPair
            hour={Math.floor(duration / 60)}
            minute={duration % 60}
            onChangeHour={(h) => setDuration(h * 60 + (duration % 60))}
            onChangeMinute={(m) => setDuration(Math.floor(duration / 60) * 60 + m)}
            labelPrefix="Длительность"
            units
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}
