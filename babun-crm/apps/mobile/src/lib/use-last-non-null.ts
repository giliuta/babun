import { useEffect, useRef } from "react";

// ПАМЯТЬ ЗАКРЫВАЮЩЕГОСЯ ЛИСТА.
//
// Лист, у которого «открыт» выражено самим значением (`client: Client | null`,
// `locationId: string | null`), на закрытии получает null — и ранний
// `if (!value) return null` размонтирует его в том же кадре. Выездная
// анимация BottomSheet при этом не проигрывается: панель не уезжает вниз, а
// пропадает. Лист должен дожить до конца анимации, показывая ПОСЛЕДНЕЕ
// содержимое; видимостью управляет отдельный флаг.
export function useLastNonNull<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(value ?? null);
  useEffect(() => {
    if (value != null) last.current = value;
  }, [value]);
  if (value != null) last.current = value;
  return last.current;
}
