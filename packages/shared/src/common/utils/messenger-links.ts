// Helpers for building WhatsApp / Telegram / Instagram deep links from a
// contact's phone and handles. All functions return `null` when there is
// not enough data to build a working link, so callers can hide the
// corresponding button.

function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

/** Номер для НАБОРА (tel:, sms:). В отличие от wa.me, которому нужны голые
 *  цифры, звонилке и SMS обязателен ведущий «+»: без него «+357 99 …»
 *  превращается в местный номер 35799… и уходит не туда. Плюс сохраняем
 *  ТОЛЬКО ведущий — внутри номера он мусор. */
export function dialableDigits(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  const digits = phoneDigits(raw);
  if (digits.length < 3) return "";
  return raw.startsWith("+") ? `+${digits}` : digits;
}

function stripAt(handle: string | null | undefined): string {
  return (handle ?? "").replace(/^@+/, "").trim();
}

export function whatsappUrl(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}`;
}

// Telegram: prefer @username, fall back to tg://resolve by phone.
// t.me links for a phone number only work if the user has a public
// username — the phone fallback uses the mobile deep-link scheme which
// Safari on iOS honours when Telegram is installed.
export function telegramUrl(
  username: string | null | undefined,
  phone: string | null | undefined
): string | null {
  const uname = stripAt(username);
  if (uname) return `https://t.me/${uname}`;
  const digits = phoneDigits(phone);
  if (digits.length < 6) return null;
  return `https://t.me/+${digits}`;
}

export function instagramUrl(username: string | null | undefined): string | null {
  const uname = stripAt(username);
  if (!uname) return null;
  return `https://instagram.com/${uname}`;
}

export function telUrl(phone: string | null | undefined): string | null {
  const dialable = dialableDigits(phone);
  return dialable ? `tel:${dialable}` : null;
}

/** SMS по тому же правилу, что звонок. Отдельные `sms:${digits}` по экранам
 *  теряли «+» и уводили сообщение на местный номер.
 *
 *  Текст сообщения здесь НЕ приклеиваем: разделитель параметра зависит от
 *  платформы (iOS «&body=», Android «?body=»), а этот пакет общий с вебом. */
export function smsUrl(phone: string | null | undefined): string | null {
  const dialable = dialableDigits(phone);
  return dialable ? `sms:${dialable}` : null;
}

// Single source of truth for the «SMS о долге» wording (previously
// duplicated + drifted between the client card and the debtors list).
// Neutral text — Babun is a SaaS, no vertical/brand in the default.
// `name` = first name (optional), `visitDate` = «DD.MM» (optional).
// C1 will replace this with a user-editable «debt» template.
export function debtReminderSms(opts: {
  amount: string;
  name?: string | null;
  visitDate?: string | null;
}): string {
  const greet = opts.name?.trim() ? `Здравствуйте, ${opts.name.trim()}!` : "Здравствуйте!";
  const visit = opts.visitDate ? ` за визит ${opts.visitDate}` : "";
  return `${greet} Напоминаем об оплате ${opts.amount}${visit}. Спасибо!`;
}
