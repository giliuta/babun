import { useCallback, useRef } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "expo-router";

// СИСТЕМНОЕ «НАЗАД» ВЫХОДИТ ИЗ РЕЖИМА, А НЕ ИЗ ПРИЛОЖЕНИЯ. Режимы
// корневых вкладок — «Перенести: Мария», «Перемещение», «Записать: Мария»,
// выбор клиентов — живут на экране, у которого нет «назад» в стеке. Android
// отдавал жест системе: приложение сворачивалось посреди переноса, а режим
// ждал человека при возвращении. На iPhone жеста нет — там только крестик.
//
// Перехват — только пока экран в фокусе: форма записи, открытая поверх
// календаря в режиме «Записать», закрывается своим «назад», а не гасит режим
// под собой. Шторки (`Modal`) ловят «назад» сами и сюда не доходят.

/** Пока `active` и экран в фокусе, системное «Назад» вызывает `onBack`. */
export function useAndroidBack(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        latest.current();
        return true;
      });
      return () => sub.remove();
    }, [active]),
  );
}
