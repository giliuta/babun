import { can, type UserRole } from "@/features/settings/role-policy";

// СТРАНИЦА НАСТРОЕК КАЛЕНДАРЯ ОТКРЫВАЕТСЯ ВСЕМ, А СТРОКИ В НЕЙ — ПО ДОСТУПУ.
//
// Владелец 20.09: «в календаре визуал всегда сохраняется… сверху слева должна
// быть шестерёнка, что там, что там; я могу зайти туда, но блоков уже внутри
// шестерёнки не будет. Визуал целой страницы мы полностью сохраняем, а потом
// просто отключаем, что будет работать, а что нет, — но оно всё идентично
// выглядит».
//
// До этого дверь закрывалась целиком: у мастера и диспетчера шестерёнки в
// шапке календаря не было вовсе, а у страницы стояла граница по роли. Теперь
// граница живёт ВНУТРИ страницы и отвечает про каждую строку отдельно —
// ровно так же, как вкладка «Клиенты» отвечает про каждое действие
// (`clients-company.ts`).
//
// Сейчас все строки экрана — это настройки КОМПАНИИ и её календаря, поэтому
// их показывает только владелец. Когда блоки `calendar.settings`,
// `calendar.day_labels` и `services` станут живыми на сервере,
// сюда придут уровни: строка появится у того, кому её открыли, а страница
// останется прежней.

/** Тариф компании: «Услуги» живут только на платном. «Мастеров» здесь
 *  больше нет — сотрудники в «Кабинет → Сотрудники» (владелец 29.09). */
export interface CalendarSettingsPlan {
  services: boolean;
}

/** ПРАВА СОТРУДНИКА НА СТРОКИ НАСТРОЕК ЭТОЙ КОМАНДЫ (владелец 30.09: блок
 *  «Настройки команды» на его странице — «может менять часовой пояс, не может
 *  график менять и так далее»). Строка приходит сюда, когда сервер проверяет
 *  её право; владелец видит всё и так. */
type RowLevel = "hidden" | "read" | "write";

export interface CalendarSettingsAccess {
  /** «График команды»: `read` — строка без двери, `write` — с правкой. */
  schedule: RowLevel;
  /** «Название и цвет» — карточка команды. */
  identity: RowLevel;
  /** «Часовой пояс». */
  timezone: RowLevel;
  /** «Часы календаря». */
  hours: RowLevel;
}

const NO_ACCESS: CalendarSettingsAccess = {
  schedule: "hidden",
  identity: "hidden",
  timezone: "hidden",
  hours: "hidden",
};

/** Что показывает страница настроек календаря этому человеку. */
export interface CalendarSettingsRows {
  /** Карточка календаря: имя, цвет, значок. */
  rename: boolean;
  /** Карточка правится (иначе — строка с именем и цветом без правки). */
  renameEdit: boolean;
  /** «Добавить» в ленте календарей. */
  addCalendar: boolean;
  timezone: boolean;
  timezoneEdit: boolean;
  currency: boolean;
  /** «Часы календаря» — видимое окно команды. */
  hours: boolean;
  hoursEdit: boolean;
  /** «График команды». */
  schedule: boolean;
  /** «График команды» открывается на правку (иначе строка только
   *  показывает график). */
  scheduleEdit: boolean;
  /** «Перерыв после записи» в шторке графика — свойство самой команды;
   *  сотрудник пишет его через `member_update_team`. */
  buffer: boolean;
  booking: boolean;
  services: boolean;
  /** «Метки» — метки дня. */
  labels: boolean;
  /** Тумблеры вида: «Показывать доход и расход», «Скрывать отменённые».
   *  Настройка КОМПАНИИ (`calendar_settings`), а не устройства. */
  viewPrefs: boolean;
  /** «Удалить календарь» — последняя строка экрана. */
  remove: boolean;
  /** Ни одной строки: страница остаётся собой — шапка и лента календарей.
   *  Это не ошибка и не «недостаточно прав», а честный вид страницы для
   *  того, кому настройки ещё не открыли. */
  any: boolean;
}

export function calendarSettingsRows(
  role: UserRole | null | undefined,
  plan: CalendarSettingsPlan,
  given: Partial<CalendarSettingsAccess> = {},
): CalendarSettingsRows {
  const manage = can(role, "manage-calendar-settings");
  const access: CalendarSettingsAccess = { ...NO_ACCESS, ...given };
  const shown = (level: RowLevel) => manage || level !== "hidden";
  const edits = (level: RowLevel) => manage || level === "write";
  const rows = {
    rename: shown(access.identity),
    renameEdit: edits(access.identity),
    addCalendar: manage,
    timezone: shown(access.timezone),
    timezoneEdit: edits(access.timezone),
    currency: manage,
    hours: shown(access.hours),
    hoursEdit: edits(access.hours),
    schedule: shown(access.schedule),
    scheduleEdit: edits(access.schedule),
    // «Видит и меняет» — меняет всё в строке, перерыв после записи тоже
    // (владелец 30.09: «разделения „владелец, директор" не будет»).
    buffer: manage || access.schedule === "write",
    booking: manage,
    services: manage && plan.services,
    labels: manage,
    viewPrefs: manage,
    remove: manage,
  };
  return {
    ...rows,
    // Считаем по самим строкам, а не по праву: строку могли погасить тарифом,
    // и «страница не пустая» должно оставаться правдой, а не намерением.
    any: Object.values(rows).some(Boolean),
  };
}
