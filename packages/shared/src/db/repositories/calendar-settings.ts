// Calendar settings repository — STORY-044.
//
// One row per tenant (PRIMARY KEY = tenant_id). The trigger from
// 20260430_005 inserts a default row at signup; the 20260430_005
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
import {
  DEFAULT_CALENDAR_SETTINGS,
  toOperationalCalendarSettings,
} from "../../local/calendar-settings";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["calendar_settings"]["Row"];
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
  // Validate grid_step at the type boundary — the DB check constraint
  // already restricts to 15/30/60, so the cast is safe.
  const grid = r.grid_step as 15 | 30 | 60;
  // v493 — personal_labels round-trip. Old rows (pre-migration
  // 20260513_001) lack the column; the typed Row may not even have
  // it. Read defensively via an indexed cast so the repo still works
  // against an outdated Supabase project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawLabels = (r as any).personal_labels;
  const personalLabels: string[] | undefined = Array.isArray(rawLabels)
    ? rawLabels.filter((x: unknown): x is string => typeof x === "string")
    : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDefault = (r as any).personal_default_label;
  const personalDefaultLabel: string | undefined =
    typeof rawDefault === "string" && rawDefault.length > 0
      ? rawDefault
      : undefined;
  return {
    startHour: r.start_hour,
    endHour: r.end_hour,
    // Минуты окна приезжают отдельным полем (миграция
    // 20260817090000_calendar_window_minutes): час остался часом, чтобы
    // не переписанный читатель не принял 510 минут за 510-й час.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startMinute: (r as any).start_minute ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    endMinute: (r as any).end_minute ?? 0,
    gridStep: grid,
    weekStart: r.week_start as "monday" | "sunday",
    timezone: r.timezone,
    bufferMinutes: r.buffer_minutes,
    hideCancelled: r.hide_cancelled,
    allowOvertime: r.allow_overtime,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showDayFinance: (r as any).show_day_finance ?? true,
    // v449 — round-trip work / scroll-open hours through Supabase.
    // Older rows return null here; the caller's sanitizer fills them
    // with the visible-range defaults so the form never crashes.
    // Cast to any: post-Sprint #3 migrations regen dropped these
    // columns from the generated Database type even though the live
    // schema still carries them on older tenants. Graceful-fallback
    // below (line 142) handles the «column does not exist» 42703 case.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workStartHour: (r as any).work_start_hour ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workEndHour: (r as any).work_end_hour ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scrollOpenHour: (r as any).scroll_open_hour ?? undefined,
    personalLabels,
    personalDefaultLabel,
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
    // Мастерский срез приходит из RPC, и минут в его сигнатуре пока нет —
    // рельс мастера просто встаёт на целый час. Добавить их в
    // `read_operational_calendar_settings_safe` можно тем же приёмом.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startMinute: (row as any).start_minute ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    endMinute: (row as any).end_minute ?? 0,
    gridStep: row.grid_step as 15 | 30 | 60,
    weekStart: row.week_start as "monday" | "sunday",
    timezone: row.timezone,
    bufferMinutes: row.buffer_minutes,
    hideCancelled: row.hide_cancelled,
    allowOvertime: row.allow_overtime,
    // `showDayFinance` здесь НЕТ намеренно: полоса «Доход / Расход» — surface
    // владельца (гейт `role === "owner"`), и мастерской проекции она не нужна
    // ни для чего. Тест `maps the safe RPC without introducing private
    // settings` ловит любую попытку протащить сюда лишнее поле — он и поймал.
    workStartHour: row.work_start_hour ?? undefined,
    workEndHour: row.work_end_hour ?? undefined,
    scrollOpenHour: row.scroll_open_hour ?? undefined,
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
  const insert: Database["public"]["Tables"]["calendar_settings"]["Insert"] = {
    tenant_id: tenantId,
  };
  if (patch.startHour !== undefined) insert.start_hour = patch.startHour;
  if (patch.endHour !== undefined) insert.end_hour = patch.endHour;
  if (patch.startMinute !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).start_minute = patch.startMinute;
  if (patch.endMinute !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).end_minute = patch.endMinute;
  if (patch.gridStep !== undefined) insert.grid_step = patch.gridStep;
  if (patch.weekStart !== undefined) insert.week_start = patch.weekStart;
  if (patch.timezone !== undefined) insert.timezone = patch.timezone;
  if (patch.bufferMinutes !== undefined) insert.buffer_minutes = patch.bufferMinutes;
  if (patch.hideCancelled !== undefined) insert.hide_cancelled = patch.hideCancelled;
  if (patch.showDayFinance !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).show_day_finance = patch.showDayFinance;
  if (patch.allowOvertime !== undefined) insert.allow_overtime = patch.allowOvertime;
  // Cast through any — see rowToSettings comment for context.
  if (patch.workStartHour !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).work_start_hour = patch.workStartHour;
  if (patch.workEndHour !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).work_end_hour = patch.workEndHour;
  if (patch.scrollOpenHour !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).scroll_open_hour = patch.scrollOpenHour;
  // v493 — round-trip personalLabels / personalDefaultLabel. Written
  // through an indexed cast since older builds of `database.types`
  // may not have the columns yet.
  if (patch.personalLabels !== undefined) {
    // Empty array → null so the Supabase column reads as «no
    // personal labels» on next fetch. Without this an explicit
    // delete-all action left the column = [...stale] forever.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).personal_labels =
      patch.personalLabels.length > 0 ? patch.personalLabels : null;
  }
  if (patch.personalDefaultLabel !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (insert as any).personal_default_label =
      patch.personalDefaultLabel && patch.personalDefaultLabel.length > 0
        ? patch.personalDefaultLabel
        : null;
  }
  const { data, error } = await supabase
    .from("calendar_settings")
    .upsert(insert, { onConflict: "tenant_id" })
    .select("*")
    .single();

  if (error) {
    const isMissingCol =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code === "42703" ||
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
