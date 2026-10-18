// Calendar settings repository — STORY-044.
//
// One row per tenant (PRIMARY KEY = tenant_id). The trigger from
// 20260430000005 inserts a default row at signup; the 20260430000005
// backfill covers existing tenants. So getCalendarSettings always
// finds a row in steady state.
//
// updateCalendarSettings uses a single upsert (`ON CONFLICT (tenant_id)
// DO UPDATE`) so a race between two devices both editing the
// settings simultaneously is serialised at the DB level — last write
// wins, no duplicate rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type {
  CalendarSettings,
  OperationalCalendarSettings,
} from "../../local/calendar-settings";
import { sanitizeDisabledFeatures } from "../../local/company-features";
import {
  DEFAULT_CALENDAR_SETTINGS,
  sanitizeRecordColorSettings,
  toOperationalCalendarSettings,
} from "../../local/calendar-settings";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["calendar_settings"]["Row"];
type Insert = Database["public"]["Tables"]["calendar_settings"]["Insert"];

const blockOrderOf = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : undefined;
type OperationalRow =
  Database["public"]["Functions"]["read_operational_calendar_settings_safe"]["Returns"][number];

interface RepositoryErrorSource {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
}

function repositoryError(
  operation: string,
  source: RepositoryErrorSource,
): Error & RepositoryErrorSource {
  const error = new Error(`${operation}: ${source.message}`) as Error &
    RepositoryErrorSource;
  error.code = source.code;
  error.details = source.details;
  error.hint = source.hint;
  return error;
}

function rowToSettings(r: Row): CalendarSettings {
  // `personal_labels` is jsonb: keep only the string entries.
  const rawLabels = r.personal_labels;
  const personalLabels: string[] | undefined = Array.isArray(rawLabels)
    ? rawLabels.filter((x): x is string => typeof x === "string")
    : undefined;
  const personalDefaultLabel: string | undefined =
    r.personal_default_label || undefined;
  return {
    startHour: r.start_hour,
    endHour: r.end_hour,
    // Minutes of the window are a separate column (migration
    // 20260817090000_calendar_window_minutes): the hour stays an hour, so a
    // reader that ignores minutes never takes 510 minutes for hour 510.
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    timezone: r.timezone,
    bufferMinutes: r.buffer_minutes,
    hideCancelled: r.hide_cancelled,
    showDayFinance: r.show_day_finance,
    // NULL work hours: the caller's sanitizer fills them with the visible
    // range, so the form never sees a hole.
    workStartHour: r.work_start_hour ?? undefined,
    workEndHour: r.work_end_hour ?? undefined,
    personalLabels,
    personalDefaultLabel,
    ...sanitizeRecordColorSettings({
      rule: r.record_color_rule,
      palette: r.record_color_palette,
      fallback: r.record_color_fallback,
    }),
    disabledFeatures: sanitizeDisabledFeatures(r.disabled_features),
    bookingBlockOrder: blockOrderOf(r.booking_block_order),
  };
}

/** Always returns settings — falls back to the locked defaults if no
 *  row exists yet (shouldn't happen post-trigger + backfill, but the
 *  guard keeps callers happy during the transition). */
export async function getCalendarSettings(
  supabase: DbSupabase,
  tenantId: string,
): Promise<CalendarSettings> {
  const { data, error } = await supabase
    .from("calendar_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw repositoryError("getCalendarSettings", error);
  if (!data) return DEFAULT_CALENDAR_SETTINGS;
  return rowToSettings(data);
}

/**
 * Reads the server-pinned, non-private company calendar projection. Unlike
 * getCalendarSettings, this is safe for a master account: the RPC has no
 * caller-supplied tenant id and never returns personal labels or days-off.
 */
export async function getOperationalCalendarSettings(
  supabase: DbSupabase,
): Promise<OperationalCalendarSettings> {
  const { data, error } = await supabase.rpc(
    "read_operational_calendar_settings_safe",
  );
  if (error) {
    throw repositoryError("getOperationalCalendarSettings", error);
  }
  const row: OperationalRow | undefined = data?.[0];
  if (!row) {
    return toOperationalCalendarSettings(DEFAULT_CALENDAR_SETTINGS);
  }
  return {
    startHour: row.start_hour,
    endHour: row.end_hour,
    startMinute: row.start_minute ?? 0,
    endMinute: row.end_minute ?? 0,
    timezone: row.timezone,
    bufferMinutes: row.buffer_minutes,
    hideCancelled: row.hide_cancelled,
    workStartHour: row.work_start_hour ?? undefined,
    workEndHour: row.work_end_hour ?? undefined,
    // Функция отдаёт сотруднику и это (STORY-088): без него у мастера были
    // бы заводские цвета записи, полоса денег не слушала бы настройку, а
    // выключенные у компании блоки стояли бы в его записи.
    showDayFinance: row.show_day_finance ?? true,
    ...sanitizeRecordColorSettings({
      rule: row.record_color_rule,
      palette: row.record_color_palette,
      fallback: row.record_color_fallback,
    }),
    disabledFeatures: sanitizeDisabledFeatures(row.disabled_features),
    bookingBlockOrder: blockOrderOf(row.booking_block_order),
  };
}

/** Upsert the singleton. Partial updates are fine — caller passes
 *  only the fields they want to change; the rest are preserved by
 *  PostgREST's `merge-duplicates` resolution. */
export async function updateCalendarSettings(
  supabase: DbSupabase,
  tenantId: string,
  patch: Partial<CalendarSettings>,
): Promise<CalendarSettings> {
  const insert: Insert = {
    tenant_id: tenantId,
  };
  if (patch.startHour !== undefined) insert.start_hour = patch.startHour;
  if (patch.endHour !== undefined) insert.end_hour = patch.endHour;
  if (patch.startMinute !== undefined) insert.start_minute = patch.startMinute;
  if (patch.endMinute !== undefined) insert.end_minute = patch.endMinute;
  if (patch.timezone !== undefined) insert.timezone = patch.timezone;
  if (patch.bufferMinutes !== undefined) insert.buffer_minutes = patch.bufferMinutes;
  if (patch.hideCancelled !== undefined) insert.hide_cancelled = patch.hideCancelled;
  if (patch.showDayFinance !== undefined) insert.show_day_finance = patch.showDayFinance;
  if (patch.workStartHour !== undefined) insert.work_start_hour = patch.workStartHour;
  if (patch.workEndHour !== undefined) insert.work_end_hour = patch.workEndHour;
  if (patch.personalLabels !== undefined) {
    // Empty array → NULL, so «delete all labels» really clears the column
    // instead of leaving the stale list behind.
    insert.personal_labels =
      patch.personalLabels.length > 0 ? patch.personalLabels : null;
  }
  if (patch.personalDefaultLabel !== undefined) {
    insert.personal_default_label =
      patch.personalDefaultLabel && patch.personalDefaultLabel.length > 0
        ? patch.personalDefaultLabel
        : null;
  }
  // ЦВЕТА ЗАПИСИ. `undefined` в патче значит «не трогаем», а `null` в колонке —
  // «владелец не выбирал, действуют заводские». Поэтому пустая палитра и
  // пустой запасной цвет пишутся именно NULL: иначе «сбросить к заводскому»
  // было бы невозможно выразить.
  if (patch.recordColorRule !== undefined) {
    insert.record_color_rule = patch.recordColorRule ?? "team";
  }
  if (patch.recordColorPalette !== undefined) {
    insert.record_color_palette =
      patch.recordColorPalette && Object.keys(patch.recordColorPalette).length > 0
        ? patch.recordColorPalette
        : null;
  }
  if (patch.recordColorFallback !== undefined) {
    insert.record_color_fallback = patch.recordColorFallback || null;
  }
  if (patch.disabledFeatures !== undefined) {
    insert.disabled_features = sanitizeDisabledFeatures(patch.disabledFeatures);
  }
  if (patch.bookingBlockOrder !== undefined) {
    insert.booking_block_order =
      patch.bookingBlockOrder && patch.bookingBlockOrder.length > 0
        ? patch.bookingBlockOrder
        : null;
  }

  const { data, error } = await supabase
    .from("calendar_settings")
    .upsert(insert, { onConflict: "tenant_id" })
    .select("*")
    .single();

  if (error) {
    const isMissingCol =
      error.code === "42703" ||
      /work_start_hour|work_end_hour|scroll_open_hour|personal_labels|personal_default_label/i.test(
        error.message,
      );
    if (isMissingCol) {
      // Never strip the requested fields and report success: the UI would
      // show “saved”, while another device (or the next refresh) loses the
      // user's calendar hours/labels. A schema gap is an actionable failed
      // write until the migration is deployed.
      throw repositoryError("updateCalendarSettings", {
        ...error,
        message:
          "на сервере не хватает колонок настроек календаря; обновите схему и повторите",
      });
    }
    throw repositoryError("updateCalendarSettings", error);
  }
  return rowToSettings(data);
}
