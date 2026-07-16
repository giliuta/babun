// payment — ЕДИНСТВЕННОЕ место, где остаток по визиту признаётся
// полученным.
//
// Запись денег — самая связанная мутация приложения: одна оплата пишет
// ПЯТЬ полей сразу, и второй путь, забывший хоть одно, разводит цифры
// между «Должниками», дневной сводкой и карточкой клиента (аудит
// «finances lie»). Поэтому патч строится здесь, а зовут его оба входа:
// карточка записи (AppointmentSheet, статус «Выполнено» + способ) и тап
// «Оплачено» на визите в карточке клиента.
//
// Источник правды по сумме — леджер payments[]: его читает getPaidAmount
// (аванс + платежи), а с него — «Должники» и сводка дня. Остальные поля
// зеркала: payment — для web PaymentBlock, payment_status/payment_method/
// paid_amount — колонки репозитория (W4).
//
// ПОЧЕМУ ТОЛЬКО НАЛ/КАРТА. Способ оплаты в модели описан ТРЕМЯ разными
// енумами, и они не совпадают:
//   · Payment.method (леджер)      — cash card transfer split invoice
//   · AppointmentPayment.method    — cash card         split invoice
//   · payment_method (колонка)     — cash card transfer         other
// Одна оплата пишется во все три сразу, поэтому честно принять можно
// только то, что понимают все — пересечение cash|card. Ровно это и
// предлагает AppointmentSheet. Расширять набор можно лишь после сведения
// енумов, иначе «Перевод» молча потеряется в payment-объекте.

import { generateId } from "@babun/shared/local/masters";
import type { Appointment, Payment } from "@babun/shared/local/appointments";
import { paymentMirrorFromLedger } from "./helpers";

/** Способы, которые понимают ВСЕ три енума модели (см. коммент выше). */
export type PayMethod = "cash" | "card";

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  cash: "Наличные",
  card: "Карта",
};

/** Платёжный срез записи, который нужен buildDebtPaidPatch (create-режим
 *  шита передаёт undefined — записи ещё нет). */
export type PaidStateSnapshot = Pick<
  Appointment,
  "payments" | "payment" | "payment_status" | "paid_amount"
>;

/**
 * Патч «остаток `amount` получен способом `method`».
 *
 * @param apt    платёжное состояние записи ДО оплаты (undefined → пустое)
 * @param amount принимаемая сумма (остаток долга по getDebtAmount)
 */
export function buildDebtPaidPatch(
  apt: PaidStateSnapshot | null | undefined,
  { method, amount }: { method: PayMethod; amount: number },
): Partial<Appointment> {
  const paidAt = new Date().toISOString();
  // Зеркально-учтённые деньги веба (payment-объект / колонка paid_amount)
  // ОБЯЗАНЫ переехать в леджер до добавления нового платежа: этот патч
  // перезаписывает зеркала свёрткой леджера, и незасеянная разница
  // превращалась бы обратно в долг на всех поверхностях. Сеем ДЕФИЦИТ
  // (зеркало − леджер), а не только случай пустого леджера — смешанные
  // строки (веб-«Частично» поверх старой мобильной оплаты) тоже реальны.
  // Способ синтетики: нал/карта раздельно из payment-объекта, пока их
  // хватает на дефицит; одинокая колонка paid_amount способа не знает →
  // «нал» (искажает лишь разбивку по способам у легаси-строк, не суммы).
  // paid_amount при статусе 'unpaid' — эхо бэкфилла 20260517_001 (аванс,
  // он живёт в prepaid_amount) — НЕ сеем; та же ветка, что в getPaidAmount.
  const existing = apt?.payments ?? [];
  const ledgerSum = existing.reduce((sum, p) => sum + p.amount, 0);
  const mirrorCash = apt?.payment?.cashAmount ?? 0;
  const mirrorCard = apt?.payment?.cardAmount ?? 0;
  const mirrorTotal = apt?.payment
    ? mirrorCash + mirrorCard
    : (apt?.payment_status ?? "unpaid") !== "unpaid"
      ? apt?.paid_amount ?? 0
      : 0;
  const seeded: Payment[] = [];
  let deficit = mirrorTotal - ledgerSum;
  if (deficit > 0) {
    const at = apt?.payment?.paid_at ?? paidAt;
    const seedCard = Math.min(deficit, mirrorCard);
    if (seedCard > 0) {
      seeded.push({ id: generateId("pay"), method: "card", amount: seedCard, paid_at: at });
      deficit -= seedCard;
    }
    if (deficit > 0)
      seeded.push({ id: generateId("pay"), method: "cash", amount: deficit, paid_at: at });
  }
  const payments: Payment[] = [
    ...existing,
    ...seeded,
    { id: generateId("pay"), method, amount, paid_at: paidAt },
  ];
  return {
    payments,
    // Зеркало payment — свёртка ПОЛНОГО леджера, а не последний платёж:
    // split-история (часть налом раньше, остаток картой сейчас) иначе
    // терялась бы из web PaymentBlock — у всех входов оплаты разом.
    payment: paymentMirrorFromLedger(payments),
    payment_status: "paid",
    payment_method: method,
    // Зеркало-колонка — actualPaid БЕЗ аванса, как пишет веб
    // (appointment-builders): ровно сумма леджера.
    paid_amount: payments.reduce((sum, p) => sum + p.amount, 0),
  };
}
