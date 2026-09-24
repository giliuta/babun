import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { money } from "@babun/shared/common/utils/money";
import type { SmsHistoryItem } from "./sms-model";

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
  new_appointment: "Подтверждение",
  reminder: "Напоминание",
  reminder_24h: "Напоминание",
  reminder_2h: "Напоминание",
  cancellation: "Отмена",
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
