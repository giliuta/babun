import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { usePersonalEventTypes } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { addMinutesHM } from "@/features/appointments/helpers";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface EventTypeInput {
  eventTypesData: ReturnType<typeof usePersonalEventTypes>["data"];
  kind: "work" | "event";
  eventTypeId: string | null;
  setEventTypeId: Setter<string | null>;
  eventTitle: string;
  setEventTitle: Setter<string>;
  setEventColor: Setter<string | null>;
  durationByHand: boolean;
  timeStart: string;
  setTimeStart: Setter<string>;
  setTimeEnd: Setter<string>;
  setDurationTouched: Setter<boolean>;
}

/** The event's type: the offered list, recognising an old title, pick, clear. */
export function useEventType({
  eventTypesData,
  kind,
  eventTypeId,
  setEventTypeId,
  eventTitle,
  setEventTitle,
  setEventColor,
  durationByHand,
  timeStart,
  setTimeStart,
  setTimeEnd,
  setDurationTouched,
}: EventTypeInput) {
  // СКРЫТЫЕ ТИПЫ ФОРМЕ НЕ ПРЕДЛАГАЮТСЯ. Запрос отдаёт их вместе с живыми —
  // ими управляет справочник, — а лента выбора показывает только живые. Тип
  // уже выбранного события остаётся видимым, даже если его скрыли после:
  // иначе правка молча меняла бы тип на «нет типа».
  const eventTypes = useMemo(() => {
    const all = eventTypesData ?? [];
    return all.filter((type) => !type.hidden || type.id === eventTypeId);
  }, [eventTypesData, eventTypeId]);

  // СОБЫТИЕ НАЗЫВАЕТСЯ ТИПОМ (порядок блоков: команда, тип, время, клиент,
  // объект, заметка; услуг и вольного названия нет). Прежнее событие с вольным названием его не теряет: пока тип не
  // выбран, в плитке стоит это название, и оно же уезжает в патч.
  const eventType = eventTypeId
    ? eventTypes.find((candidate) => candidate.id === eventTypeId) ?? null
    : null;
  // Прежнее событие, чьё название совпадает с типом, узнаёт свой тип само.
  useEffect(() => {
    if (kind !== "event" || eventTypeId || !eventTitle.trim()) return;
    const match = eventTypes.find(
      (candidate) =>
        candidate.label.trim().toLowerCase() === eventTitle.trim().toLowerCase(),
    );
    if (match) setEventTypeId(match.id);
  }, [kind, eventTypes, eventTitle, eventTypeId, setEventTypeId]);

  const applyEventType = (id: string) => {
    const preset = eventTypes.find((candidate) => candidate.id === id);
    if (!preset) return;
    setEventTypeId(preset.id);
    setEventTitle(preset.label);
    setEventColor(preset.color);
    // Длительность типа — СТАНДАРТ, а не приказ: если человек уже выбрал
    // время сам, тип красит и называет событие, но время не трогает.
    if (!durationByHand) {
      const start = timeStart === "00:00" ? "10:00" : timeStart;
      setTimeStart(start);
      setTimeEnd(addMinutesHM(start, preset.defaultDuration));
      setDurationTouched(true);
    }
    haptics.tap();
  };

  // ПОВТОРНЫЙ ТАП СНИМАЕТ ТИП (строки «Без типа» в шторке нет). Так снятие живёт ТАМ ЖЕ, где выбор: палец возвращается к той же строке, а
  // список не растёт на служебную строку, которой в других шторках нет.
  //
  // Событие без типа законно: кнопка его не требует, а называется такое событие
  // словом «Событие». Снять выбранный тип можно повторным тапом.
  //
  // НАЗВАНИЕ УХОДИТ ВМЕСТЕ С ТИПОМ. `eventTitle` — снимок имени типа, а эффект
  // выше узнаёт тип по совпадению имени: оставь название — и тип вернётся сам
  // в следующем же кадре.
  //
  // ЦВЕТ: доставшийся от типа уходит с ним, выбранный рукой остаётся. Отличаем
  // их сравнением с цветом самого типа — другого следа «руки» у события нет.
  const clearEventType = () => {
    const preset = eventTypes.find((candidate) => candidate.id === eventTypeId);
    haptics.tap();
    setEventTypeId(null);
    setEventTitle("");
    setEventColor((current) =>
      preset && current === preset.color ? null : current,
    );
  };

  return { eventTypes, eventType, applyEventType, clearEventType };
}
