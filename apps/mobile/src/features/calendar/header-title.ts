// ЗАГОЛОВОК КАЛЕНДАРЯ (29.09): неделя 28 сен – 4 окт при сегодняшнем 29
// сентября называлась «Октябрь 2026» — по четвергу. Неделя на стыке месяцев
// называет оба: «Сен – Окт 2026»; на стыке лет — «Дек 2026 – Янв 2027».
// Коротко, чтобы шапка не переносилась на узком телефоне.

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

/** «Сентябрь 2026» — месяц одной даты. */
export function monthTitle(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Заголовок недели по первому и последнему дню. */
export function weekTitle(first: Date, last: Date): string {
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return monthTitle(first);
  }
  if (first.getFullYear() === last.getFullYear()) {
    return `${SHORT[first.getMonth()]} – ${SHORT[last.getMonth()]} ${last.getFullYear()}`;
  }
  return `${SHORT[first.getMonth()]} ${first.getFullYear()} – ${SHORT[last.getMonth()]} ${last.getFullYear()}`;
}
