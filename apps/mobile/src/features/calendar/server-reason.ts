import { isHumanText } from "@babun/shared/i18n/runtime";

/**
 * ПРИЧИНА ОТКАЗА СЕРВЕРА для тоста. Сторожа базы (protect_paid_appointment_
 * finance, guard_appointment_history_delete, RPC оплаты) объясняют отказ
 * по-русски: «Возвращённую оплату нельзя изменить; создайте новую заявку».
 * Репозиторий заворачивает текст в `updateAppointment: …` — и на экране
 * оставался только «Не удалось изменить запись», причина терялась.
 *
 * Русский текст после префикса — это объяснение для человека, его и
 * показываем. Английское или пустое (сеть, PostgREST, таймаут) — не для
 * диспетчера: остаётся общая подпись вызывающего.
 */
export function serverReason(error: unknown): string | null {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const text = raw.replace(/^[A-Za-z_][\w.]*:\s*/, "").trim();
  // На другом языке наш собственный отказ уже переведён — он тоже для людей.
  return isHumanText(text) ? text : null;
}
