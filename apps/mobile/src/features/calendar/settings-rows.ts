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
// `calendar.day_labels`, `services` и `masters` станут живыми на сервере,
// сюда придут уровни: строка появится у того, кому её открыли, а страница
// останется прежней.

/** Тариф компании: две строки экрана живут только на платном. */
export interface CalendarSettingsPlan {
  services: boolean;
  masters: boolean;
}

/** Что показывает страница настроек календаря этому человеку. */
export interface CalendarSettingsRows {
  /** Карточка календаря: имя, цвет, значок. */
  rename: boolean;
  /** «Добавить» в ленте календарей. */
  addCalendar: boolean;
  timezone: boolean;
  currency: boolean;
  masters: boolean;
  /** «Часы календаря» — видимое окно команды. */
  hours: boolean;
  /** «График команды». */
  schedule: boolean;
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
): CalendarSettingsRows {
  const manage = can(role, "manage-calendar-settings");
  const rows = {
    rename: manage,
    addCalendar: manage,
    timezone: manage,
    currency: manage,
    masters: manage && plan.masters,
    hours: manage,
    schedule: manage,
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
