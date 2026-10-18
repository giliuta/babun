// Personal-calendar event types. Cached on the device per company.
//
// User-configurable list of "kinds" of events that show up as a tile
// grid in the new PersonalEventSheet. Each type carries an icon, a
// label, a colour, a default duration, and an optional all-day flag.
// ЗАГОТОВОК НЕТ: события нестандартные, каждый заводит свои. Первый запуск — пустой
// список; компания заводит свои типы в Календарь → Запись → Страница события.

import { getStorage } from "../storage/provider";

/** СЛАГ ЗНАЧКА — ЭТО ДАННЫЕ, А НЕ ПЕРЕЧИСЛЕНИЕ . Закрытый союз имён —
 *  собственный словарь типов событий — стал бы стеной: слаг из общего набора
 *  (40 значков на продукт) в него не проходил бы, а расширять его каждым
 *  новым значком значит держать словарь в двух местах.
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
   *  и возвращается одним касанием (свайп вправо — удалить, влево —
   *  скрыть, как у услуг и меток). Удалённый тип не
   *  приезжает с сервера вовсе — у него своя колонка `deleted_at`. */
  hidden: boolean;
  /** Команда, которой принадлежит тип (типы событий у каждой команды;
   *  миграция 20260924233000). У старых кэшей поля нет. */
  teamId?: string;
}

const STORAGE_KEY = "babun2:settings:personal-event-types";

/** КЭШ — ПО КОМПАНИИ. Он первый кадр списка до ответа сервера; общий на
 *  телефон ключ показывал бы в одной компании типы другой (и предлагал бы
 *  их шаблонами). Старый общий ключ не читается: чей он — не знает никто. */
function scopedStorageKey(tenantId: string): string {
  return `${STORAGE_KEY}:tenant:${tenantId}`;
}

/** Id пяти прежних заготовок (Обед, Встреча, Выезд в офис, Выходной, Отпуск).
 *  На сервер они не уезжали ни у кого (в базе строк не было), но лежат
 *  в памяти телефонов; загрузка их выбрасывает. Свои типы (id `pet-…`) не
 *  трогаются. */
const RETIRED_SEED_IDS = new Set([
  "ev-lunch",
  "ev-meeting",
  "ev-office",
  "ev-dayoff",
  "ev-vacation",
]);

export function loadPersonalEventTypes(tenantId: string): PersonalEventType[] {
  // DATA-LOSS GUARD (offline-fallback resurrection fix): distinguish
  // «key never written» (first run → empty list; заготовок нет)
  // from «key written as an empty list» (the user deleted
  // every type → respect that, return []). getRaw returns null ONLY
  // when the key is absent; a saved `[]` comes back as the string
  // "[]". The old `parsed.length === 0 → SEED` path revived the five
  // seeds in the pure-offline fallback, and the next save re-uploaded
  // them as live rows. Online sync (usePersonalEventTypes) already
  // disambiguates via soft-deleted rows — this only fixes the loader
  // it falls back to. Same pattern as services.ts / expense-categories.
  const key = scopedStorageKey(tenantId);
  const raw = getStorage().getRaw(key);
  if (raw === null) return [];
  const parsed = getStorage().get<PersonalEventType[]>(key);
  if (!Array.isArray(parsed)) {
    // Corrupt / non-array payload — пустой список, как у первого запуска.
    return [];
  }
  return parsed
      .filter((p) => !RETIRED_SEED_IDS.has(String(p.id ?? "")))
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
        ...(typeof p.teamId === "string" ? { teamId: p.teamId } : {}),
      }))
      .sort((a, b) => a.order - b.order);
}

export function savePersonalEventTypes(
  types: PersonalEventType[],
  tenantId: string,
): void {
  getStorage().set(scopedStorageKey(tenantId), types);
}

export function generatePersonalEventTypeId(): string {
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
