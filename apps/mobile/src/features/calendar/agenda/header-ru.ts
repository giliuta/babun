import { parseYMD } from "@/features/appointments/helpers";

// «Сегодня» / «Завтра» / «Понедельник, 14 июля» — web formatHeaderRu.
// С меткой дня — «Вс, 20 сентября»: полный день недели плюс «ЛИМАССОЛ» не
// влезали в строку рядом с «Маршрут →» (аудит 29.09).
export function headerRu(
  ymd: string,
  todayYmd: string,
  tomorrowYmd: string,
  short = false,
): string {
  if (ymd === todayYmd) return "Сегодня";
  if (ymd === tomorrowYmd) return "Завтра";
  const s = parseYMD(ymd).toLocaleDateString("ru-RU", {
    weekday: short ? "short" : "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
