import { useState } from "react";

/** Open/closed flag of every sheet of the booking form — one plain state each,
 *  so every open/close transition stays exactly as it was. */
export function useBookSheets() {
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  // Событие: команда («Личное» + команды) и ТИП — оба листом выбора. Тип до
  // 2026-09-10 выбирался лентой плиток прямо в форме; владелец свёл его к
  // архитектуре категории: блок со шапкой + каноническая шторка.
  const [eventTeamSheetOpen, setEventTeamSheetOpen] = useState(false);
  const [eventTypeSheetOpen, setEventTypeSheetOpen] = useState(false);
  const [colorSheetOpen, setColorSheetOpen] = useState(false);
  const [objectSheet, setObjectSheet] = useState(false);
  // Выбор/замена объекта — лист блока «Объект» (владелец 2026-09-03);
  // правка выбранного объекта — кружком «…» в его строке (2026-09-04).
  const [objectPicker, setObjectPicker] = useState(false);
  const [objectEdit, setObjectEdit] = useState(false);
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
    labelSheetOpen,
    setLabelSheetOpen,
    totalSheetOpen,
    setTotalSheetOpen,
  };
}
