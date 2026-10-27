import { parseYMD } from "@/features/appointments/helpers";

// «Сегодня» / «Завтра» / «Пн, 14 июля» — web formatHeaderRu.
//
// ДЕНЬ НЕДЕЛИ — КОРОТКИЙ У ВСЕХ ДНЕЙ (CAL-43). Полный («Воскресенье, 20
// сентября») вместе с меткой «ЛИМАССОЛ» и «Маршрут →» в строку не влезал,
// и сокращали только день с меткой — в ленте «MONDAY 5 OCTOBER» стояло
// рядом с «TUE 6 OCTOBER». Одна форма на все шапки, место под метку есть
// всегда.
export function headerRu(ymd: string, todayYmd: string, tomorrowYmd: string): string {
  if (ymd === todayYmd) return "Сегодня";
  if (ymd === tomorrowYmd) return "Завтра";
  const s = parseYMD(ymd).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
