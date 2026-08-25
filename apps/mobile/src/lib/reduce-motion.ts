import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// ЖИВОЙ флаг «Уменьшение движения». Reanimated-овский useReducedMotion
// читает системную настройку ОДИН раз за процесс: пользователь включает
// тумблер в Настройках iOS, возвращается в приложение — и анимации всё
// ещё играют, пока приложение не перезапустят. Для человека, которому
// движение вызывает тошноту или головокружение, это не мелочь.
//
// Здесь — подписка на изменение настройки, поэтому эффект наступает
// сразу. API совпадает с прежним хуком, так что замена — механическая.

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {
        // Настройку не удалось прочитать — считаем, что движение можно.
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => setReduced(v),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
