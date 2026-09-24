import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { money } from "@babun/shared/common/utils/money";
import type { SmsEvent, SmsHistoryItem } from "./sms-model";

// СЛОВА СТРАНИЦЫ SMS (STORY-089). Баланс и цены SMS — в евро всегда: сервис
// берёт деньги в евро, а валюта компании про записи, а не про SMS.

export const euro = (cents: number): string => money(cents / 100, "EUR");

/** «≈ 124 SMS» — сколько коротких сообщений влезет в баланс. Кириллица длиннее
 *  одной части стоит дороже — поэтому «≈». */
export function balanceWords(balanceCents: number, freeLeft: number, priceCents: number): string {
  const paid = priceCents > 0 ? Math.floor(balanceCents / priceCents) : 0;
  const parts = [`≈ ${paid} SMS`];
  if (freeLeft > 0) parts.push(formatCountRu(freeLeft, ["бесплатная", "бесплатные", "бесплатных"]));
  return parts.join(" · ");
}

export const HOURS_OPTIONS = [2, 3, 6, 12, 24, 48] as const;

export function hoursWords(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "За сутки" : `За ${formatCountRu(days, ["день", "дня", "дней"])}`;
  }
  return `За ${formatCountRu(hours, ["час", "часа", "часов"])}`;
}

/** События — слово владельца и когда оно уходит. */
export const EVENT_TITLES: Record<SmsEvent, string> = {
  new_appointment: "Новая запись",
  reminder: "Напоминание",
  reminder_2: "Второе напоминание",
  reschedule: "Перенос",
  cancellation: "Отмена",
  thank_you: "Спасибо",
  repeat: "Пора повторить",
};

/** Группы событий на странице: до визита, изменения, после визита. */
export const EVENT_GROUPS: readonly { title: string; events: readonly SmsEvent[] }[] = [
  { title: "До визита", events: ["new_appointment", "reminder", "reminder_2"] },
  { title: "Изменения", events: ["reschedule", "cancellation"] },
  { title: "После визита", events: ["thank_you", "repeat"] },
];

/** У каких событий есть срок и какой. */
export function timingKind(event: SmsEvent): "before" | "after" | "months" | null {
  if (event === "reminder" || event === "reminder_2") return "before";
  if (event === "thank_you") return "after";
  if (event === "repeat") return "months";
  return null;
}

export const TIMING_OPTIONS: Record<"before" | "after" | "months", readonly number[]> = {
  before: HOURS_OPTIONS,
  after: [1, 2, 3, 6, 24],
  months: [3, 6, 9, 12],
};

/** «Сразу», «За сутки», «Через 2 часа», «Через 6 месяцев». */
export function timingWords(event: SmsEvent, timing: number | null): string {
  const kind = timingKind(event);
  if (!kind || timing == null) return "Сразу";
  if (kind === "before") return hoursWords(timing);
  if (kind === "after") {
    return timing % 24 === 0 && timing > 0
      ? timing === 24
        ? "Через сутки"
        : `Через ${formatCountRu(timing / 24, ["день", "дня", "дней"])}`
      : `Через ${formatCountRu(timing, ["час", "часа", "часов"])}`;
  }
  return `Через ${formatCountRu(timing, ["месяц", "месяца", "месяцев"])}`;
}

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** «Сентябрь» — счёт команды за текущий месяц. */
export const monthWords = (date: Date): string => MONTHS[date.getMonth()] ?? "";

const hh = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** «21:00–08:00» или «Нет». */
export function quietWords(from: number, to: number): string {
  return from === to ? "Нет" : `${hh(from)}–${hh(to)}`;
}

/** Тихие часы на выбор: пара «с — до», а «Нет» — одинаковые. */
export const QUIET_OPTIONS: readonly { from: number; to: number }[] = [
  { from: 21, to: 8 },
  { from: 20, to: 9 },
  { from: 22, to: 8 },
  { from: 22, to: 9 },
  { from: 0, to: 0 },
];

const STATUS: Record<SmsHistoryItem["status"], string> = {
  queued: "Отправляется",
  sending: "Отправляется",
  sent: "Отправлено",
  delivered: "Доставлено",
  failed: "Не доставлено",
  undelivered: "Не доставлено",
  blocked: "Не хватило баланса",
};

export const statusWords = (status: SmsHistoryItem["status"]): string => STATUS[status] ?? status;

export function isFailure(status: SmsHistoryItem["status"]): boolean {
  return status === "failed" || status === "undelivered" || status === "blocked";
}

const TRIGGER: Record<string, string> = {
  ...EVENT_TITLES,
  reminder_24h: "Напоминание",
  reminder_2h: "Напоминание",
  manual: "Вручную",
  test: "Проверка",
};

export const triggerWords = (trigger: string): string => TRIGGER[trigger] ?? "SMS";

/** Сколько стоило: «€0,20», «бесплатно»; неотправленное — пусто. */
export function costWords(item: Pick<SmsHistoryItem, "status" | "costCents" | "wasFree">): string | undefined {
  if (item.status === "queued" || item.status === "sending" || item.status === "blocked") return undefined;
  if (item.status === "failed" && item.costCents === 0 && !item.wasFree) return undefined;
  if (item.wasFree) return "бесплатно";
  return item.costCents > 0 ? euro(item.costCents) : undefined;
}

/** Цена текста до отправки: части × цена части. */
export function priceOf(segments: number, priceCents: number): string {
  return euro(Math.max(1, segments) * priceCents);
}
