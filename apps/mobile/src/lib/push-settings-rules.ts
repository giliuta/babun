// Правила пуш-настроек человека — без React и сети, под тестом.
// Хуки с базой — `push-settings.ts`.

export interface PushSettings {
  digestMorning: boolean;
  digestEvening: boolean;
  /** Тихие часы — минуты суток; `null` — выключены. Окно может идти через полночь. */
  quietStart: number | null;
  quietEnd: number | null;
}

export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  digestMorning: false,
  digestEvening: false,
  quietStart: null,
  quietEnd: null,
};

/** Тихие часы по умолчанию, когда их включают: 22:00–07:00. */
export const DEFAULT_QUIET = { start: 22 * 60, end: 7 * 60 };

interface PushSettingsRow {
  digest_morning: boolean | null;
  digest_evening: boolean | null;
  quiet_start: number | null;
  quiet_end: number | null;
}

const minute = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1440 ? v : null;

export function pushSettingsFromRow(row: Partial<PushSettingsRow> | null | undefined): PushSettings {
  const quietStart = minute(row?.quiet_start);
  const quietEnd = minute(row?.quiet_end);
  const quietOn = quietStart !== null && quietEnd !== null && quietStart !== quietEnd;
  return {
    digestMorning: row?.digest_morning === true,
    digestEvening: row?.digest_evening === true,
    quietStart: quietOn ? quietStart : null,
    quietEnd: quietOn ? quietEnd : null,
  };
}

/** «22:00 – 07:00». */
export function quietLabel(start: number, end: number): string {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(start)} – ${hhmm(end)}`;
}

/** Правка → столбцы строки: только то, что правили. */
export function pushSettingsColumns(patch: Partial<PushSettings>): Record<string, boolean | number | null> {
  const out: Record<string, boolean | number | null> = {};
  if (patch.digestMorning !== undefined) out.digest_morning = patch.digestMorning;
  if (patch.digestEvening !== undefined) out.digest_evening = patch.digestEvening;
  if (patch.quietStart !== undefined) out.quiet_start = patch.quietStart;
  if (patch.quietEnd !== undefined) out.quiet_end = patch.quietEnd;
  return out;
}
