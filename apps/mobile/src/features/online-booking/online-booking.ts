import { dayWords } from "@/features/sms/appointment-link";

// ОНЛАЙН-ЗАПИСЬ — ФОРМА ДАННЫХ. Чистый модуль: токен, адрес, разбор ответов
// базы и слова страницы. Без React и сети — его читают тесты.
//
// Заказчик открывает babun.app/b/<токен календаря>, выбирает услугу, время и
// оставляет имя с телефоном; запись встаёт в календарь команды. Окна считает
// сервер (`online_booking_slots`): заказчик не видит записей команды, только
// свободное время.

/** Страница открыта, закрыта владельцем (или тарифом) или ссылки нет. */
export type BookingPageState = "open" | "closed" | "missing";

export interface BookingService {
  id: string;
  name: string;
  /** Минуты; 0 — у услуги нет своей длительности. */
  duration: number;
}

export interface BookingPage {
  state: BookingPageState;
  businessName: string;
  logoUrl: string | null;
  calendarName: string;
  /** Страна компании — код номера по умолчанию («CY»). */
  country: string | null;
  services: BookingService[];
}

export interface BookingDay {
  /** «YYYY-MM-DD». */
  date: string;
  /** «ЧЧ:ММ» по порядку. */
  times: string[];
}

export interface BookingDone {
  businessName: string;
  service: string;
  date: string;
  time: string;
}

/** Настройки календаря для шестерёнки владельца. */
export interface BookingSettings {
  enabled: boolean;
  token: string | null;
  services: (BookingService & { online: boolean })[];
}

/** Токен — 10–64 знака латиницы и цифр (сервер выдаёт 12 base62). */
export function isBookingToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Za-z]{10,64}$/.test(value);
}

/** Адрес страницы для Instagram, Google-профиля и визитки. */
export function bookingUrl(token: string): string {
  return `https://babun.app/b/${token}`;
}

const STATES: readonly BookingPageState[] = ["open", "closed", "missing"];

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const minutes = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

function parseService(v: unknown): BookingService | null {
  const r = obj(v);
  const id = str(r.id);
  const name = str(r.name);
  return id && name ? { id, name, duration: minutes(r.duration) } : null;
}

export function parseBookingPage(data: unknown): BookingPage {
  const r = obj(data);
  const state = STATES.includes(r.state as BookingPageState) ? (r.state as BookingPageState) : "missing";
  const services = Array.isArray(r.services)
    ? r.services.map(parseService).filter((s): s is BookingService => s !== null)
    : [];
  return {
    // Открытая страница без единой услуги записывать не может — для
    // заказчика это то же «закрыто».
    state: state === "open" && services.length === 0 ? "closed" : state,
    businessName: str(r.business_name) ?? "",
    logoUrl: str(r.logo_url),
    calendarName: str(r.calendar_name) ?? "",
    country: str(r.country),
    services,
  };
}

export function parseBookingDays(data: unknown): BookingDay[] {
  const days = obj(data).days;
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => {
      const r = obj(d);
      const date = str(r.date);
      const times = Array.isArray(r.times)
        ? r.times.filter((x): x is string => typeof x === "string" && /^\d{2}:\d{2}$/.test(x))
        : [];
      return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && times.length ? { date, times } : null;
    })
    .filter((d): d is BookingDay => d !== null);
}

export function parseBookingDone(data: unknown): BookingDone {
  const r = obj(data);
  return {
    businessName: str(r.business_name) ?? "",
    service: str(r.service) ?? "",
    date: str(r.date) ?? "",
    time: str(r.time) ?? "",
  };
}

export function parseBookingSettings(data: unknown): BookingSettings {
  const r = obj(data);
  const services = Array.isArray(r.services)
    ? r.services
        .map((v) => {
          const s = parseService(v);
          return s ? { ...s, online: obj(v).online === true } : null;
        })
        .filter((s): s is BookingService & { online: boolean } => s !== null)
    : [];
  const token = str(r.token);
  return { enabled: r.enabled === true, token: isBookingToken(token) ? token : null, services };
}

/** «30 мин», «1 ч», «1 ч 30 мин»; без длительности — пусто. */
export function durationWords(min: number): string {
  if (!(min > 0)) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** «Пт» и «31 окт» — короткая плашка дня в ленте. */
export function dayChipWords(date: string): { weekday: string; day: string } {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return {
    weekday: WEEKDAYS_SHORT[at.getUTCDay()],
    day: `${at.getUTCDate()} ${MONTHS_SHORT[at.getUTCMonth()]}`,
  };
}

const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
// Те же сокращения, что в шапке периода (`lib/period.ts`): уже переведены.
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «Пятница, 31 октября в 15:00» — итог записи, как в SMS. */
export function doneWords(done: Pick<BookingDone, "date" | "time">): string {
  const day = dayWords(done.date);
  if (!day) return done.time;
  return done.time ? `${day} в ${done.time}` : day;
}
