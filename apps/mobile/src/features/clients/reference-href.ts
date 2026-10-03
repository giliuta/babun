import { usePathname } from "expo-router";

// КУДА ВЕДЁТ ШЕСТЕРЁНКА СПРАВОЧНИКА — РЕШАЕТ МАРШРУТ, А НЕ ФЛАГ.
//
// Справочники карточки клиента («Типы объектов», «Карты для маршрута»,
// «Способы связи») живут ВНУТРИ вкладки «Клиенты». Открытые с экрана, который
// лежит НАД табами — запись, шторка долга в финансах, — они кладут поверх него
// вторую копию табов: «назад» приводит на список клиентов, и запись со всем
// набранным исчезает. Владелец 2026-09-04, поймав это на типах объектов: «жму
// назад — и закрывается; так не должно быть, назад всегда должно перекидывать
// на запись, запись просто так не может закрыться».
//
// Поэтому у тех же экранов есть второй адрес в корневом стеке — группа
// `app/(shared)`. Экран один и тот же, разный только адрес.
//
// ПРАВИЛО ЧИТАЕТСЯ ОТ ВКЛАДКИ, А НЕ ОТ ЗВАВШЕГО: внутри «Клиентов» — свои
// маршруты, отовсюду ещё — общие. Раньше здесь стояло «начинается с /book», и
// адрес врал, как только ту же карточку позвали финансы.
export function useReferenceHref() {
  const inClientsTab = usePathname().startsWith("/clients");
  return {
    objectTypes: inClientsTab
      ? ("/clients/object-types" as const)
      : ("/object-types" as const),
    maps: inClientsTab ? ("/clients/maps" as const) : ("/maps" as const),
    channels: inClientsTab
      ? ("/clients/channels" as const)
      : ("/channels" as const),
    // Метки и теги — шестерёнки листов карточки (03.10): `/cabinet/labels`
    // переключал таб-бар на «Кабинет», `/clients/tags` из карточки поверх
    // записи уводил во вкладку — «назад» не возвращал в карточку.
    labels: inClientsTab ? ("/clients/labels" as const) : ("/labels" as const),
    tags: inClientsTab ? ("/clients/tags" as const) : ("/tags" as const),
    // Услуги, типы событий и категории живут в Кабинете; общий адрес нужен по
    // той же причине, что и остальным: экран над табами не может уходить во
    // вкладку. Категории добавлены 2026-09-10 — их дверь из листа операции
    // уводила на календарь (`/cabinet/categories` — это вкладка «Кабинет»).
    services: ("/services" as const),
    eventTypes: ("/event-types" as const),
    categories: ("/categories" as const),
    // СТРАНИЦЫ САМОЙ КАРТОЧКИ (аудит 03.10): с 03.10 тап по объекту, файлу,
    // реквизитам и «Ещё N» уводит на страницу — и карточка, открытая поверх
    // записи (`/client`), уводила во вкладку, бросая запись под табами.
    clientPage: (page: ClientSubPage) =>
      inClientsTab ? (`/clients/${page}` as const) : (`/client-${page}` as const),
  };
}

/** Страницы карточки клиента, у которых есть второй адрес в `app/(shared)`. */
export type ClientSubPage = "visits" | "objects" | "attachments" | "requisites" | "sms" | "people";

/** Экран во вкладке «Клиенты» — нижний край держит таб-бар; над табами —
 *  свой (иначе кнопка внизу легла бы на полоску «домой»). */
export function useInClientsTab(): boolean {
  return usePathname().startsWith("/clients");
}
