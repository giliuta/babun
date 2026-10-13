// Settings data layer (calendar settings, location labels, personal event
// types) — public surface. The hooks live in `./local-settings/` by table;
// importers keep using this path.
//
// Settings live in the canonical Supabase tables (calendar_settings,
// personal_event_types — same as web), so changes sync across devices.
// MMKV via the storage seam is only a write-through
// cache: every successful read/save refreshes it. Reads may fall back for a
// rolling deployment or a confirmed transport outage; permission and
// validation errors remain visible to the user, and writes never hide network
// failures.

export type { LocationLabel } from "@babun/shared/local/location-labels";
export type { PersonalEventType } from "@babun/shared/local/personal-event-types";
export {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "./local-settings/calendar-settings";
export {
  locationLabelsOfTeam,
  useLocationLabels,
  useSaveLocationLabels,
} from "./local-settings/location-labels";
export {
  usePersonalEventTypes,
  useSavePersonalEventTypes,
} from "./local-settings/personal-event-types";
