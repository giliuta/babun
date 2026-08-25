import type { CalendarSettings } from "@babun/shared/local/calendar-settings";

export interface CalendarSaveState {
  scope: string;
  nextId: number;
  confirmed: CalendarSettings;
  pending: Map<number, Partial<CalendarSettings>>;
}

export function createCalendarSaveState(
  scope: string,
  confirmed: CalendarSettings,
): CalendarSaveState {
  return {
    scope,
    nextId: 0,
    confirmed,
    pending: new Map(),
  };
}

export function currentCalendarSaveValue(
  state: CalendarSaveState,
): CalendarSettings {
  let settings = { ...state.confirmed };
  for (const patch of state.pending.values()) {
    settings = { ...settings, ...patch };
  }
  return settings;
}

export function beginCalendarSave(
  state: CalendarSaveState,
  patch: Partial<CalendarSettings>,
): number {
  const id = ++state.nextId;
  state.pending.set(id, patch);
  return id;
}

export function confirmCalendarSave(
  state: CalendarSaveState,
  id: number | undefined,
  canonical: CalendarSettings,
): void {
  state.confirmed = canonical;
  if (id !== undefined) state.pending.delete(id);
}

export function rejectCalendarSave(
  state: CalendarSaveState,
  id: number | undefined,
): void {
  if (id !== undefined) state.pending.delete(id);
}
