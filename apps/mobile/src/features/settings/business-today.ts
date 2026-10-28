import { todayYmd } from "@/lib/paper/format";
import { useCalendarSettings } from "./local-settings";

/** «Сегодня» компании, YYYY-MM-DD — по часовому поясу календаря, тем же
 *  правилом, что сетка и «Финансы» (`useBusinessClock`), а не по часам
 *  телефона: владелец в другом поясе после своей полуночи видел бы долгом
 *  запись, которая у команды ещё сегодняшняя. Пока настройки не пришли —
 *  пояс по умолчанию, как у всех читателей `todayYmd`. */
export function useBusinessToday(): string {
  const settings = useCalendarSettings();
  return todayYmd(settings.data?.timezone ?? "Europe/Nicosia");
}
