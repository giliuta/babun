import type { Appointment } from "@babun/shared/local/appointments";

// «КАК В ПРОШЛЫЙ РАЗ» (строка на карточке клиента).
//
// Самая частая работа сервисной компании — не новый клиент, а тот же самый:
// та же квартира, та же услуга, та же бригада, раз в месяц. Через обычную
// запись это шесть экранов, из которых пять просто повторяют прошлое.
//
// Здесь берётся ПОСЛЕДНИЙ СОСТОЯВШИЙСЯ визит и превращается в заготовку.
// Правила:
//   • отменённые не в счёт — это не «как в прошлый раз», а «как не было»;
//   • берём прошедшие визиты: будущая запись уже стоит в календаре, и
//     повторять её незачем;
//   • без услуг заготовка бессмысленна (повторять нечего) — возвращаем null,
//     и строка на карточке не появляется вовсе;
//   • услуга, которой БОЛЬШЕ НЕТ в справочнике, не считается: запись хранит
//     только её id и цену, без имени. Строка тогда не могла сказать, что
//     повторяет, а тап нёс мёртвый id в форму записи.

export interface RepeatTarget {
  /** Услуги прошлого визита — экран записи проставит их и цену. */
  serviceIds: string[];
  /** Тот же объект (куда ехали) и та же бригада (кто ездил). */
  locationId: string | null;
  teamId: string | null;
  /** Дата того визита (YYYY-MM-DD) — для подписи «был 30 мая». */
  date: string;
}

export function lastVisitTarget(
  appts: readonly Appointment[],
  todayYmd: string,
  /** Id услуг, которые ЕЩЁ ЖИВЫ в справочнике. Пока справочник не загрузился
   *  — пустой набор, и строка не появляется: лучше подождать полсекунды, чем
   *  показать «Как в прошлый раз» без единого слова о том, что это за раз. */
  liveServiceIds: ReadonlySet<string>,
): RepeatTarget | null {
  let best: Appointment | null = null;
  let bestIds: string[] = [];
  let bestKey = "";
  for (const a of appts) {
    if (a.status === "cancelled") continue;
    if (a.kind && a.kind !== "work") continue;
    // ТОЛЬКО ЗАКРЫТЫЙ ВИЗИТ. Незакрытая вчерашняя запись («запланирована», а
    // дата прошла) — это не «как в прошлый раз», а недоделанное дело: сам
    // продукт показывает её отдельным статусом «Визит не закрыт». Повторять
    // работу, которой, возможно, не было, нельзя.
    if (a.status !== "completed") continue;
    if (!a.date || a.date > todayYmd) continue;
    // Удалённые услуги отсеиваются ЗДЕСЬ, до выбора победителя: иначе
    // свежий визит с одной снесённой услугой закрывал собой прошлый,
    // который повторить ещё можно.
    const ids = serviceIdsOf(a).filter((id) => liveServiceIds.has(id));
    if (ids.length === 0) continue;
    // Ключ дата+время: при двух визитах в один день сравнение по одной дате
    // отдавало победу порядку массива — и строка подставляла утреннюю
    // мойку вместо вечернего ремонта.
    const key = `${a.date}${a.time_start ?? ""}`;
    if (!best || key > bestKey) {
      best = a;
      bestIds = ids;
      bestKey = key;
    }
  }
  if (!best) return null;
  return {
    serviceIds: bestIds,
    locationId: best.location_id ?? null,
    teamId: best.team_id ?? null,
    date: best.date,
  };
}

/** Услуги записи: новый массив `services` — канон, `service_ids` — легаси
 *  тех же данных (см. Appointment). Берём первый непустой. */
export function serviceIdsOf(a: Appointment): string[] {
  const fromServices = (a.services ?? [])
    .map((s) => s.serviceId)
    .filter(Boolean);
  if (fromServices.length > 0) return fromServices;
  return (a.service_ids ?? []).filter(Boolean);
}
