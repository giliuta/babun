// ИСТОРИЯ SMS — ОТБОР И ГРУППЫ (STORY-089; владелец 29.09: «полноценно
// красивую страницу, где хранятся все SMS»). Чистый модуль: плитки-фильтры по
// итогу, поиск, дни с итогом дня. Без React — его читают тесты.

import type { SmsHistoryItem } from "./sms-model";

/** Плитки страницы — они же фильтры. */
export type SmsBucket = "all" | "delivered" | "waiting" | "failed";

export function bucketOf(status: SmsHistoryItem["status"]): Exclude<SmsBucket, "all"> {
  if (status === "delivered") return "delivered";
  if (status === "failed" || status === "undelivered" || status === "blocked") return "failed";
  // Ушло к оператору, но доставку ещё не подтвердили, или ждёт своего часа.
  return "waiting";
}

export function countBuckets(items: readonly SmsHistoryItem[]): Record<SmsBucket, number> {
  const out: Record<SmsBucket, number> = { all: items.length, delivered: 0, waiting: 0, failed: 0 };
  for (const item of items) out[bucketOf(item.status)] += 1;
  return out;
}

/** Поиск: имя клиента, номер (цифры), текст. */
export function matchesSearch(item: SmsHistoryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3 && item.toPhone.replace(/\D/g, "").includes(digits)) return true;
  return [item.clientName, item.body, item.templateBody].some((s) => !!s && s.toLowerCase().includes(q));
}

export function filterHistory(
  items: readonly SmsHistoryItem[],
  bucket: SmsBucket,
  query: string,
): SmsHistoryItem[] {
  return items.filter((item) => (bucket === "all" || bucketOf(item.status) === bucket) && matchesSearch(item, query));
}

const WEEKDAYS = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const MONTHS = [
  "ЯНВАРЯ", "ФЕВРАЛЯ", "МАРТА", "АПРЕЛЯ", "МАЯ", "ИЮНЯ",
  "ИЮЛЯ", "АВГУСТА", "СЕНТЯБРЯ", "ОКТЯБРЯ", "НОЯБРЯ", "ДЕКАБРЯ",
];

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** «Сегодня», «Вчера», «ЧТ, 24 СЕНТЯБРЯ» — как дни в ленте финансов. */
export function dayTitle(date: Date, now: Date): string {
  const today = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dayKey(date);
  if (key === today) return "СЕГОДНЯ";
  if (key === dayKey(yesterday)) return "ВЧЕРА";
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export interface SmsDay {
  key: string;
  title: string;
  count: number;
  /** Сколько стоили сообщения дня (у сотрудника цен нет — ноль). */
  cents: number;
  data: SmsHistoryItem[];
}

/** Дни по времени создания, новые сверху — список уже приходит отсортированным. */
export function groupByDay(items: readonly SmsHistoryItem[], now: Date): SmsDay[] {
  const days: SmsDay[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, title: dayTitle(date, now), count: 0, cents: 0, data: [] };
      days.push(day);
    }
    day.data.push(item);
    day.count += 1;
    day.cents += item.costCents;
  }
  return days;
}
