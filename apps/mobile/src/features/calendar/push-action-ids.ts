// Кнопки уведомления о записи — без React Native: этот лист читают
// разборщик тапа (`reminders.ts`) и тесты под node. Сами действия —
// `push-actions.ts`.

/** Категории пуша `push_activity`; имена совпадают с сервером. */
export const APPOINTMENT_CATEGORY = "babun-appointment";
export const CANCEL_CATEGORY = "babun-cancel";

export type PushAction = "call" | "route" | "day";

const ACTION_IDS: Record<string, PushAction> = {
  call: "call",
  route: "route",
  "open-day": "day",
};

/** Нажатая кнопка уведомления; тап по самому уведомлению и «Открыть» — `undefined`. */
export function pushActionFrom(actionIdentifier: string | null | undefined): PushAction | undefined {
  return actionIdentifier ? ACTION_IDS[actionIdentifier] : undefined;
}
