import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { todayYmd } from "@/lib/paper/format";
import { useCalendarSettings } from "./local-settings";

/** «Сегодня» компании, которое само замечает полночь. `useBusinessToday`
 *  пересчитывается только перерисовкой: форма документа, открытая вечером и
 *  оставленная без касаний, после полуночи печатала в превью вчерашний день и
 *  номер прошлого года, а сервер выпускал документ уже новым днём. Сверка —
 *  раз в минуту и при возврате приложения из фона; тот же день перерисовки не
 *  вызывает. */
export function useLiveBusinessToday(): string {
  const settings = useCalendarSettings();
  const zone = settings.data?.timezone ?? "Europe/Nicosia";
  const [today, setToday] = useState(() => todayYmd(zone));
  useEffect(() => {
    const check = () => setToday(todayYmd(zone));
    check();
    const timer = setInterval(check, 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [zone]);
  return today;
}
