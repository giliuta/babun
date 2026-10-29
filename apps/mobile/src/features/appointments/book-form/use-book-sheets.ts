import { useState } from "react";

/** Open/closed flag of every sheet of the booking form — one plain state each,
 *  so every open/close transition stays exactly as it was. */
export function useBookSheets() {
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  // Событие: команда («Личное» + команды) и ТИП — оба листом выбора. Тип — как категория: блок со шапкой +
  // каноническая шторка (не лента плиток в форме).
  const [eventTeamSheetOpen, setEventTeamSheetOpen] = useState(false);
  const [eventTypeSheetOpen, setEventTypeSheetOpen] = useState(false);
  const [colorSheetOpen, setColorSheetOpen] = useState(false);
  const [objectSheet, setObjectSheet] = useState(false);
  // Выбор/замена объекта — лист блока «Объект»;
  // правка выбранного объекта — удержанием его строки.
  const [objectPicker, setObjectPicker] = useState(false);
  const [objectEdit, setObjectEdit] = useState(false);
  // Объект события без клиента — своя форма (`PlaceSheet`), без списка.
  const [placeSheet, setPlaceSheet] = useState(false);
  const [labelSheetOpen, setLabelSheetOpen] = useState(false);
  const [totalSheetOpen, setTotalSheetOpen] = useState(false);
  return {
    reminderSheetOpen,
    setReminderSheetOpen,
    clientPickerOpen,
    setClientPickerOpen,
    servicePickerOpen,
    setServicePickerOpen,
    whenOpen,
    setWhenOpen,
    teamSheetOpen,
    setTeamSheetOpen,
    eventTeamSheetOpen,
    setEventTeamSheetOpen,
    eventTypeSheetOpen,
    setEventTypeSheetOpen,
    colorSheetOpen,
    setColorSheetOpen,
    objectSheet,
    setObjectSheet,
    objectPicker,
    setObjectPicker,
    objectEdit,
    setObjectEdit,
    placeSheet,
    setPlaceSheet,
    labelSheetOpen,
    setLabelSheetOpen,
    totalSheetOpen,
    setTotalSheetOpen,
  };
}
