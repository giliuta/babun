// Personal-calendar event types. Persisted in localStorage.
//
// User-configurable list of "kinds" of events that show up as a tile
// grid in the new PersonalEventSheet. Each type carries an icon, a
// label, a colour, a default duration, and an optional all-day flag.
// Five iOS-Reminders-style defaults seed first-run; the user adds /
// edits / deletes from /dashboard/settings/calendar/event-types.

import { getStorage } from "../storage/provider";

/** СЛАГ ЗНАЧКА — ЭТО ДАННЫЕ, А НЕ ПЕРЕЧИСЛЕНИЕ (2026-09-10). Здесь стоял союз
 *  из двадцати одного имени — собственного словаря типов событий. Владелец
 *  попросил один набор на продукт («сделать 40 иконок, то же самое, что цвет»),
 *  и союз стал стеной: слаг из общих сорока в него не проходил, а расширять
 *  его каждым новым значком значит держать словарь в двух местах.
 *
 *  Что защищает от мусора теперь: выбор идёт из общего набора (`ICON_PRESETS`),
 *  а показ проходит через `eventTypeIcon()` — незнакомое имя рисуется ярлычком,
 *  а не падает. Старые слаги («coffee», «moon», «dumbbell») продолжают жить:
 *  их держит карта совместимости в `event-type-icons.ts`. */
export type PersonalEventTypeIcon = string;

export interface PersonalEventType {
  id: string;
  label: string;
  icon: PersonalEventTypeIcon;
  color: string;            // hex
  /** minutes; ignored when allDay=true */
  defaultDuration: number;
  allDay: boolean;
  /** Lower number sorts first in the picker grid. */
  order: number;
  /** Скрытый тип не предлагается в форме события, но остаётся в справочнике
   *  и возвращается одним касанием (владелец 2026-09-08: «свайп вправо —
   *  удалить, влево — скрыть», как у услуг и меток). Удалённый тип не
   *  приезжает с сервера вовсе — у него своя колонка `deleted_at`. */
  hidden: boolean;
}

const STORAGE_KEY = "babun2:settings:personal-event-types";

export const SEED_PERSONAL_EVENT_TYPES: PersonalEventType[] = [
  { id: "ev-lunch",    label: "Обед",         icon: "coffee",     color: "#FF9500", defaultDuration: 60,  allDay: false, order: 0, hidden: false },
  { id: "ev-meeting",  label: "Встреча",      icon: "briefcase",  color: "#007AFF", defaultDuration: 60,  allDay: false, order: 1, hidden: false },
  { id: "ev-office",   label: "Выезд в офис", icon: "navigation", color: "#AF52DE", defaultDuration: 90,  allDay: false, order: 2, hidden: false },
  { id: "ev-dayoff",   label: "Выходной",     icon: "moon",       color: "#8E8E93", defaultDuration: 720, allDay: true,  order: 3, hidden: false },
  { id: "ev-vacation", label: "Отпуск",       icon: "plane",      color: "#34C759", defaultDuration: 720, allDay: true,  order: 4, hidden: false },
];

export function loadPersonalEventTypes(): PersonalEventType[] {
  // DATA-LOSS GUARD (offline-fallback resurrection fix): distinguish
  // «key never written» (genuine first run → seed the iOS-style
  // defaults) from «key written as an empty list» (the user deleted
  // every type → respect that, return []). getRaw returns null ONLY
  // when the key is absent; a saved `[]` comes back as the string
  // "[]". The old `parsed.length === 0 → SEED` path revived the five
  // seeds in the pure-offline fallback, and the next save re-uploaded
  // them as live rows. Online sync (usePersonalEventTypes) already
  // disambiguates via soft-deleted rows — this only fixes the loader
  // it falls back to. Same pattern as services.ts / expense-categories.
  const raw = getStorage().getRaw(STORAGE_KEY);
  if (raw === null) return SEED_PERSONAL_EVENT_TYPES;
  const parsed = getStorage().get<PersonalEventType[]>(STORAGE_KEY);
  if (!Array.isArray(parsed)) {
    // Corrupt / non-array payload — fall back to seeds rather than
    // an empty screen. (A valid empty list is `[]`, handled above.)
    return SEED_PERSONAL_EVENT_TYPES;
  }
  return parsed
      .map((p, i) => ({
        id: String(p.id ?? `ev-${Date.now()}-${i}`),
        label: String(p.label ?? "").trim() || "Без названия",
        icon: (p.icon ?? "tag") as PersonalEventTypeIcon,
        color: String(p.color ?? "#007AFF"),
        defaultDuration: Number.isFinite(p.defaultDuration)
          ? Math.max(5, Math.min(24 * 60, Number(p.defaultDuration)))
          : 60,
        allDay: Boolean(p.allDay),
        order: Number.isFinite(p.order) ? Number(p.order) : i,
        // Старый кэш поля не знает: тип из него — видимый.
        hidden: Boolean(p.hidden),
      }))
      .sort((a, b) => a.order - b.order);
}

export function savePersonalEventTypes(types: PersonalEventType[]): void {
  getStorage().set(STORAGE_KEY, types);
}

export function generatePersonalEventTypeId(): string {
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
