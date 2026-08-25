// STORY-002: пресеты личных событий команды.
// Отображаются в Event-режиме BookingSheet (сетка 3×2). Каждое
// пресет-событие блокирует слот только для выбранной команды.

export interface EventPreset {
  id: string;
  label: string;
  /** Тип иконки — использует встроенные SVG-глифы из EventMode. */
  icon: "coffee" | "briefcase" | "navigation" | "moon" | "plane";
  duration: number;   // минуты
  color: string;      // HEX акцентный цвет
  /** true = на весь рабочий день (8:00–20:00). */
  allDay?: boolean;
}

export const EVENT_PRESETS: EventPreset[] = [
  { id: "ev-lunch",    label: "Обед",         icon: "coffee",     duration: 60,  color: "#F59E0B" },
  { id: "ev-meeting",  label: "Встреча",      icon: "briefcase",  duration: 60,  color: "#3B82F6" },
  { id: "ev-office",   label: "Выезд в офис", icon: "navigation", duration: 90,  color: "#8B5CF6" },
  { id: "ev-dayoff",   label: "Выходной",     icon: "moon",       duration: 720, color: "#64748B", allDay: true },
  { id: "ev-vacation", label: "Отпуск",       icon: "plane",      duration: 720, color: "#10B981", allDay: true },
];
