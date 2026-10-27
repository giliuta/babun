// ЗАСТАВКА ЕЩЁ НА ЭКРАНЕ? Лист без react-native: его спрашивает запуск
// обновления по воздуху, и правило проверяется тестом.

let left = false;

/** Заставка начала уходить — человек видит приложение и может нажимать. */
export function markSplashLeft(): void {
  left = true;
}

export function splashOnScreen(): boolean {
  return !left;
}
