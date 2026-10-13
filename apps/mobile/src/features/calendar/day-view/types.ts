// Per-date work band (minutes since midnight) resolved from team_schedules
// by the parent via shared getDayScheduleForDate — web DayColumn.tsx:231.
// breaks — перерывы команды (обед и т.п.): серые полосы на сетке.
export type WorkBand = {
  startMin: number;
  endMin: number;
  breaks?: { startMin: number; endMin: number }[];
};

// Отрезок свободного времени для режима «Записать» — один зелёный кубик.
export type FreeSlotRange = { startMin: number; endMin: number };
