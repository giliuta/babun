// Тонкая обёртка над expo-haptics. Нативный модуль добавлен ПОСЛЕ текущих
// dev-билдов: статический import валил бы ВСЁ приложение на старте («Cannot
// find native module», expo-router грузит route-модули при буте) — тот же
// guarded require, что у expo-contacts в clients/[id].tsx. На старых билдах
// Haptics = null и все функции — тихие no-op; после нативной пересборки
// работают как задумано. Все вызовы fire-and-forget: хаптика никогда не
// задерживает и не роняет вызывающий код.
let Haptics: typeof import("expo-haptics") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Haptics = require("expo-haptics");
} catch {
  Haptics = null;
}

export const haptics = {
  /** Лёгкий «тик» выбора — открытие меню, «Сегодня». */
  tap() {
    void Haptics?.selectionAsync().catch(() => {});
  },
  /** Мягкий удар — физический отклик (drag-перенос лёг на слот). */
  impact() {
    if (!Haptics) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** Операция удалась (статус, оплата, перенос). */
  success() {
    if (!Haptics) return;
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  },
  /** Разрушаемое действие (удаление) — предупреждающий паттерн. */
  warning() {
    if (!Haptics) return;
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
  },
  /** Операция провалилась. */
  error() {
    if (!Haptics) return;
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Error,
    ).catch(() => {});
  },
};
