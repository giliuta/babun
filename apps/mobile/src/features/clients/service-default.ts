import type { Client } from "@babun/shared/local/clients";

// «ОБСЛУЖИВАНИЕ» — ИНТЕРВАЛ У КОМАНДЫ (владелец 30.09: «обслуживание тоже
// можно сделать»).
//
// Фильтр «Пора обслужить» считал только объекты со своим интервалом
// (`Location.serviceEveryMonths`), а поставить его объекту было негде — фильтр
// не срабатывал ни разу. Теперь интервал ставит команда в «Настройках
// клиентов» (`team_design.service_every_months`): объект её клиента без
// своего интервала обслуживается раз в столько месяцев, отсчёт — от
// последнего визита на объект (`client-stats`).
//
// ТОЛЬКО ДЛЯ СЧЁТА. Подставленный интервал живёт в копии клиентов, которую
// видит `buildStatsMap`; в карточку и в запись объекта он не попадает —
// иначе первая же правка объекта прошила бы умолчание команды в объект.

/** Выбор в шторке: `null` — «Не напоминать». */
export const SERVICE_MONTH_CHOICES: readonly (number | null)[] = [null, 1, 2, 3, 4, 6, 12];

/** «Раз в 6 мес» / «Не напоминать». */
export function serviceMonthsLabel(months: number | null | undefined): string {
  return months ? `Раз в ${months} мес` : "Не напоминать";
}

type ServiceClient = Pick<Client, "team_id" | "locations">;

/**
 * Клиенты с интервалом команды у объектов без своего. Без единого умолчания
 * возвращает тот же массив — мемо списка не пересчитывается зря.
 */
export function withServiceDefault<T extends ServiceClient>(
  clients: readonly T[],
  monthsOf: (teamId: string | null | undefined) => number | null,
): T[] {
  let changed = false;
  const out = clients.map((c) => {
    const months = monthsOf(c.team_id);
    const locations = c.locations;
    if (!months || !locations?.some((l) => !l.serviceEveryMonths)) return c;
    changed = true;
    return {
      ...c,
      locations: locations.map((l) =>
        l.serviceEveryMonths ? l : { ...l, serviceEveryMonths: months },
      ),
    };
  });
  return changed ? out : (clients as T[]);
}
