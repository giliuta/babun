import { isHumanText } from "@babun/shared/i18n/runtime";
import { looksLikeNoConnection } from "@/lib/connection-words";

// «ВХОД И БЕЗОПАСНОСТЬ» ГОВОРИТ СЛОВАМИ (аудит Кабинета 03.10). Смена пароля
// показывала ответ Supabase как есть — «Password is known to be weak…»,
// «Request rate limit reached», — а удаление аккаунта любой отказ сервера
// печатало «Edge Function returned a non-2xx status code».

/** Отказ смены пароля → фраза. Обрыв связи возвращается как есть: его
 *  узнаёт `writeErrorWords` и скажет «Нет связи с сервером». */
export function passwordRefusal(message: string): string {
  if (looksLikeNoConnection({ message })) return message;
  if (/should be different|same.*password/i.test(message)) {
    return "Новый пароль совпадает с текущим.";
  }
  if (/weak|pwned|known to be|leaked/i.test(message)) {
    return "Пароль слишком простой или уже встречался в утечках — придумайте другой.";
  }
  if (/at least \d+|too short|characters/i.test(message)) {
    return "Пароль слишком короткий.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "Слишком много попыток — подождите минуту и повторите.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Почта аккаунта не подтверждена — подтвердите её по письму.";
  }
  return isHumanText(message) ? message : "Сервер не принял новый пароль. Попробуйте ещё раз.";
}

const DELETE_NOT_DONE = "Аккаунт не удалён";

/** Отказ функции удаления → ошибка со словами. Тело ответа читается: в нём
 *  код отказа, а сообщение клиента одно на все случаи. */
export async function deleteRefusal(error: unknown): Promise<Error> {
  const e = error as {
    name?: string;
    context?: { status?: number; clone?: () => { json: () => Promise<unknown> } };
  };
  if (e?.name === "FunctionsFetchError") {
    return new Error(`Нет связи с сервером. ${DELETE_NOT_DONE} — повторите, когда связь вернётся.`);
  }
  const status = e?.context?.status;
  let code = "";
  try {
    const body = (await e?.context?.clone?.().json()) as { error?: unknown } | undefined;
    code = typeof body?.error === "string" ? body.error : "";
  } catch {
    // тело не читается — решает статус
  }
  if (/confirmation does not match/i.test(code)) {
    return new Error("Фраза подтверждения не совпала.");
  }
  if (status === 401) {
    return new Error(`Сессия устарела — войдите заново и повторите. ${DELETE_NOT_DONE}.`);
  }
  return new Error(`Удаление сейчас недоступно — попробуйте позже. ${DELETE_NOT_DONE}.`);
}
