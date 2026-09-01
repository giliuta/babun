import {
  CITY_CLEARED,
  dayCityKey,
  type DayCityMap,
} from "@babun/shared/local/day-cities";
import { isoWeekdayOf } from "@babun/shared/common/utils/date-utils";

// КАКАЯ МЕТКА У ЭТОГО ДНЯ — ОДНО ПРАВИЛО НА ПРОДУКТ.
//
// Жило внутри экрана календаря (`labelFor` в (home)/index.tsx) и наружу не
// выводилось. Пока читатель был один, это было незаметно; с формой записи,
// которая обязана показать ту же метку в шапке, копия разошлась бы на первой
// же правке — а расходиться ей нельзя: календарь и форма говорили бы о
// РАЗНЫХ метках одного дня.
//
// `resolveDayLabel` из shared сюда не годится: он отвечает только про ЯВНУЮ
// метку и про расписание не знает вовсе (так и написано в его комментарии —
// «календарный рендер со своим фолбэком живёт в labelFor»). Здесь и есть тот
// фолбэк, вынесенный из экрана.
//
// ПОРЯДОК ЖЁСТКИЙ, И КАЖДАЯ СТУПЕНЬ — ЧЬЁ-ТО РЕШЕНИЕ:
//   1. сентинел «снято руками» — метки нет, и расписание её не воскрешает;
//   2. явная метка дня — рука диспетчера побеждает настройку всегда;
//   3. расписание метки, и ТОЛЬКО для дат сегодня и вперёд.
//
// Третья ступень обрезана датой не из осторожности: закон канона от
// 2026-08-29 — «прошлое не переписывается настройкой». Вычисляемое значение
// по определению следует за текущими настройками, поэтому смена расписания
// иначе перекрасила бы позапрошлый вторник.

/** Метка, какой её видит календарь: имя, цвет и решение «красить ли день». */
export interface DayLabel {
  name: string;
  color: string;
  /** `cities.tint_day` — заливать ли колонку дня цветом метки. */
  tint: boolean;
}

/** Строка справочника меток, какая нужна этому правилу. Не весь `City`:
 *  модулю незачем знать про `position`, `country` и прочее. */
export interface DayLabelCity {
  name: string;
  color: string | null;
  weekdays: number[] | null;
  is_active: boolean;
  deleted_at: string | null;
  tint_day?: boolean | null;
}

export function resolveCalendarDayLabel(opts: {
  dayCities: DayCityMap;
  /** Метки ЭТОЙ команды. Порядок важен: при двух метках на один день недели
   *  выигрывает первая — но до этого не доходит, редактор меток запрещает
   *  двум меткам занять один день. */
  cities: readonly DayLabelCity[];
  teamId: string | null;
  dateYmd: string;
  /** Сегодня. Расписание действует с этой даты и вперёд. */
  todayYmd: string;
  /** Чем красить метку, которой уже нет в справочнике: имя на дне стоит,
   *  цвета взять неоткуда. */
  fallbackColor: string;
}): DayLabel | null {
  const { dayCities, cities, teamId, dateYmd, todayYmd, fallbackColor } = opts;
  if (!teamId) return null;

  const assigned = dayCities[dayCityKey(teamId, dateYmd)];
  if (assigned === CITY_CLEARED) return null;

  const scheduled =
    assigned == null && dateYmd >= todayYmd
      ? cities.find(
          (c) =>
            c.is_active &&
            !c.deleted_at &&
            (c.weekdays ?? []).includes(isoWeekdayOf(dateYmd)),
        )?.name
      : undefined;

  const name = assigned ?? scheduled ?? "";
  if (!name) return null;

  const city = cities.find((c) => c.name === name);
  return {
    name,
    color: city?.color ?? fallbackColor,
    tint: city?.tint_day ?? true,
  };
}
