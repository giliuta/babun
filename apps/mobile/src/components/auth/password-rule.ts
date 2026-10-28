// ПАРОЛЬ — ЛЁГКИЙ МОЖНО, НЕЛЕПЫЙ НЕЛЬЗЯ. Ни цифр, ни заглавных, ни знаков не
// требуем; длина — на нижней границе Supabase (меньше 6 сервер не примет ни при
// какой настройке). Лёгкий пароль — можно, бессмысленный набор — нет. Сервер
// утёкшие пароли не проверяет (HIBP выключен), поэтому совсем пустые
// наборы — один символ, ряд подряд, повтор, «password» — отсекаем здесь.
// Одно правило на регистрацию, сброс и смену пароля в Кабинете.

const PASSWORD_MIN = 6;

/** Набран, но короче нижней границы — показать подсказку. */
function passwordTooShort(password: string): boolean {
  return password.length > 0 && password.length < PASSWORD_MIN;
}

// Ряды, кусок которых подряд (в любую сторону) — не пароль: 123456, 654321,
// abcdef, qwerty, йцукен.
// i18n-ignore-block — буквы раскладок, не текст интерфейса.
const RUNS = [
  "01234567890",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
  "йцукенгшщзхъ",
  "фывапролджэ",
  "ячсмитьбю",
];

// Самые затёртые слова и связки, которые рядом и повтором не ловятся.
// i18n-ignore-block — сверяется с набранным, не показывается.
const WORN = new Set([
  "password",
  "password1",
  "пароль",
  "qwerty123",
  "qwe123",
  "123qwe",
  "1q2w3e",
  "1q2w3e4r",
  "abc123",
  "123abc",
  "iloveyou",
  "admin123",
  "babun",
  "babun123",
]);

/** Длина в порядке, но пароль — пустой набор: 123456, 111111, 121212, qwerty. */
export function passwordTooSimple(password: string): boolean {
  if (password.length < PASSWORD_MIN) return false;
  const p = password.toLowerCase();
  if (/^(.{1,3})\1+$/u.test(p)) return true;
  if (WORN.has(p)) return true;
  const back = [...p].reverse().join("");
  return RUNS.some((run) => run.includes(p) || run.includes(back));
}

/** Пароль, с которым кнопку можно нажать. */
export function passwordAccepted(password: string): boolean {
  return password.length >= PASSWORD_MIN && !passwordTooSimple(password);
}

/** Строка под полем пароля или null, если сказать нечего. */
export function passwordHint(password: string): string | null {
  if (passwordTooShort(password)) return "Минимум 6 символов";
  if (passwordTooSimple(password)) return "Слишком простой пароль — как 123456 или 111111";
  return null;
}
