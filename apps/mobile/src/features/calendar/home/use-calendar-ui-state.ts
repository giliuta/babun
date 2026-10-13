import { useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ActionMenu } from "@/features/calendar/ActionMenuSheet";
import type { SlotDraft } from "@/features/calendar/BookSlotSheet";

/** Open/closed state of the screen's sheets and menus. Effects that reset
 *  it live with their causes. */
export function useCalendarUiState() {
  // «Отправить SMS» из меню записи (владелец 03.10: «зажимаю запись — в
  // шторке сразу „Отправить SMS“»): та же шторка, что у трубки клиента —
  // шаблоны, потом текст и две кнопки.
  const [smsApt, setSmsApt] = useState<Appointment | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [crewViewing, setCrewViewing] = useState<Appointment | null>(null);
  // «ЦВЕТ» ИЗ МЕНЮ ДОЛГОГО НАЖАТИЯ (владелец 2026-09-24: «после записи функция
  // смены цветов — максимально улучшить»). Раньше цвет менялся только из формы
  // записи: пять тапов, и «Применить» в листе лишь закрывал его, а сохранял
  // футер формы. Отсюда — тап по цвету сразу пишет запись.
  const [recolor, setRecolor] = useState<Appointment | null>(null);
  // Меню записи и свободного времени — наша шторка (`ActionMenuSheet`).
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  // Дата, чью метку правим (null = пикер закрыт): шапка Дня открывает свой
  // день, тап по дате в Неделе — свою (долгое нажатие там открывает день).
  const [cityPickerYmd, setCityPickerYmd] = useState<string | null>(null);
  // Тапнутый пустой слот сетки (null = лист закрыт): лист «Новая запись»
  // уточняет время барабаном и ведёт в /book Клиентом или Событием.
  const [slotDraft, setSlotDraft] = useState<SlotDraft | null>(null);
  // Разбор финансов дня по тапу на футер Доход/Расход (null = закрыт).
  const [finModalYmd, setFinModalYmd] = useState<string | null>(null);
  // «Напомнить…» из меню записи — та же шторка, что колокольчик в шапке
  // записи (владелец 24.09): одно правило «себе» на телефоне, пуш пересчитан
  // от даты и времени записи в поясе её команды.
  const [reminderFor, setReminderFor] = useState<Appointment | null>(null);
  const [firstCalendarFailed, setFirstCalendarFailed] = useState(false);

  return {
    smsApt, setSmsApt, smsOpen, setSmsOpen, miniCalOpen, setMiniCalOpen, crewViewing,
    setCrewViewing, recolor, setRecolor, sheetMenu, setSheetMenu, cityPickerYmd,
    setCityPickerYmd, slotDraft, setSlotDraft, finModalYmd, setFinModalYmd, reminderFor,
    setReminderFor, firstCalendarFailed, setFirstCalendarFailed,
  };
}

export type CalendarUiState = ReturnType<typeof useCalendarUiState>;
