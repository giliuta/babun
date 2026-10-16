// ПАРОЛЬ — КАКОЙ УГОДНО. Ни цифр, ни заглавных, ни знаков — только длина, и та на
// нижней границе Supabase: меньше 6 символов сервер не принимает ни при какой
// настройке. Одно число на регистрацию, сброс и смену пароля в Кабинете —
// раньше три экрана держали своё «8».

export const PASSWORD_MIN = 6;

/** Набран, но короче нижней границы — показать подсказку. */
export function passwordTooShort(password: string): boolean {
  return password.length > 0 && password.length < PASSWORD_MIN;
}
