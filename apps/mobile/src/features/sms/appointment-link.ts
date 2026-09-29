import { smsVars } from "./sms-compose";

// ССЫЛКА «ПОДТВЕРДИТЬ / ОТМЕНИТЬ» — ФОРМА ДАННЫХ (STORY-089, волна 7).
// Чистый модуль: токен, разбор ответа базы и слова страницы. Без React и
// сети — его читают тесты.
//
// Кипрские номера ответных SMS не принимают, поэтому клиент отвечает
// ссылкой из SMS: babun.app/r/<токен> → страница его записи с «Подтверждаю»
// и «Отменить запись».

/** Состояние записи для клиента: ждёт ответа, подтверждена, отменена,
 *  прошла или ссылки нет. */
export type LinkState = "pending" | "confirmed" | "cancelled" | "past" | "missing";

export interface AppointmentLinkInfo {
  state: LinkState;
  businessName: string;
  logoUrl: string | null;
  clientFirstName: string;
  /** «YYYY-MM-DD». */
  date: string | null;
  /** «ЧЧ:ММ». */
  time: string | null;
  address: string | null;
  services: string[];
}

/** Токен — 10–64 знака латиницы и цифр (сервер выдаёт 12 base62). */
export function isAppointmentLinkToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Za-z]{10,64}$/.test(value);
}

const STATES: readonly LinkState[] = ["pending", "confirmed", "cancelled", "past", "missing"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseAppointmentLink(data: unknown): AppointmentLinkInfo {
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const state = STATES.includes(r.state as LinkState) ? (r.state as LinkState) : "missing";
  return {
    state,
    businessName: str(r.business_name) ?? "",
    logoUrl: str(r.logo_url),
    clientFirstName: str(r.client_first_name) ?? "",
    date: str(r.date),
    time: str(r.time),
    address: str(r.address),
    services: Array.isArray(r.services)
      ? r.services.map(str).filter((x): x is string => !!x)
      : [],
  };
}

/** «Пятница, 25 сентября» — день словами, как в SMS. */
export function dayWords(date: string | null): string | null {
  const vars = smsVars({ date });
  if (!vars.Day || !vars.Date) return null;
  return `${vars.Day.charAt(0).toUpperCase()}${vars.Day.slice(1)}, ${vars.Date}`;
}

/** Заголовок страницы по состоянию. */
export function linkTitle(info: Pick<AppointmentLinkInfo, "state" | "clientFirstName">): string {
  const name = info.clientFirstName;
  switch (info.state) {
    case "pending":
      return name ? `${name}, вы записаны` : "Вы записаны";
    case "confirmed":
      return "Запись подтверждена";
    case "cancelled":
      return "Запись отменена";
    case "past":
      return "Эта запись уже прошла";
    case "missing":
      return "Ссылка не найдена";
  }
}
