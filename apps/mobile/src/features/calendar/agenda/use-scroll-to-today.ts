import { useEffect, useRef } from "react";
import type { FlatList } from "react-native";
import type { AgendaSection } from "./types";

export function useScrollToToday(sections: AgendaSection[], todayYmd: string) {
  // ТЕКУЩИЙ МЕСЯЦ ОТКРЫВАЕТСЯ НА СЕГОДНЯ (повторный аудит 03.10). Лента
  // начиналась с 1-го числа, а кнопки «Сегодня» в текущем месяце нет: к
  // двадцатому числу загруженного месяца до своего дня приходилось листать
  // через весь прошедший. Прошедшие дни месяца остаются выше — пальцем вверх.
  // Один раз на месяц: новая запись в ленте не дёргает прокрутку.
  const listRef = useRef<FlatList<AgendaSection>>(null);
  const monthKey = sections[0]?.title.slice(0, 7) ?? "";
  const todayIndex = todayYmd.startsWith(monthKey)
    ? sections.findIndex((s) => s.title >= todayYmd)
    : -1;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!monthKey || scrolledFor.current === monthKey) return;
    scrolledFor.current = monthKey;
    if (todayIndex <= 0) return;
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index: todayIndex, animated: false }),
    );
  }, [monthKey, todayIndex]);
  return listRef;
}
