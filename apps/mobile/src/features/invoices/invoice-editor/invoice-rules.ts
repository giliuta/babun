// Pure rules of the invoice form: what the source visit brings, the opening
// tax mode, the discount, and the one reason the button is grey. No React.

import type { Appointment } from "@babun/shared/local/appointments";
import { applyDiscount, round2 } from "@babun/shared/local/finance/appointment-calc";
import type {
  InvoiceLedgerWithLines,
  InvoiceLineDraft,
  InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import { companyFilled } from "@/features/companies/company-rules";
import type { Company } from "@/features/companies/queries";
import {
  type EditableInvoiceLine,
  formatInvoiceMoney,
  invoiceVatMode,
  parseMoneyAmount,
} from "../format";
import type { InvoicePrefill } from "./types";

export interface AppointmentVat {
  mode: "inclusive" | "exclusive";
  rate: number;
}

/** НАЛОГ ЗАПИСИ ПЕРЕЕЗЖАЕТ В ИНВОЙС (22.09). «К оплате» записи уже
 *  включает VAT: при «сверху» строки счёта раскладываются на сумму ДО
 *  налога, и инвойс начисляет его сам той же ставкой — иначе налог вошёл бы
 *  в цены и был начислен второй раз. */
export function appointmentVatOf(
  sourceAppointment: Pick<Appointment, "vat_mode" | "vat_rate"> | null,
): AppointmentVat | null {
  return sourceAppointment &&
    (sourceAppointment.vat_mode === "inclusive" || sourceAppointment.vat_mode === "exclusive") &&
    (sourceAppointment.vat_rate ?? 0) > 0
    ? { mode: sourceAppointment.vat_mode, rate: Number(sourceAppointment.vat_rate) }
    : null;
}

// ИНВОЙС ИЗ ДОХОДА (разбор 2026-09-22, баг 5): сервер требует, чтобы итог
// счёта совпал с пришедшими деньгами до цента. Услуги записи годятся,
// только если доход — вся её сумма; частичная оплата — одна строка на сумму
// дохода.
export function incomeAmountOf(prefill: InvoicePrefill | undefined): number | null {
  return prefill?.transactionId && (prefill.amount ?? 0) > 0 ? round2(prefill.amount as number) : null;
}

/** Скидка выставленного счёта — его строка с минусовой ценой: она уходит в
 *  пару «евро + число», а не в услуги. */
export function existingDiscountOf(
  existing: { lines: readonly { unit_price: number; qty: number }[] } | null | undefined,
): number {
  return existing
    ? round2(
        existing.lines
          .filter((line) => line.unit_price < 0)
          .reduce((sum, line) => sum - line.unit_price * line.qty, 0),
      )
    : 0;
}

// Деньги дохода уже пришли С НАЛОГОМ: строка на его сумму считает VAT «в
// цене». «Сверху» начислил бы налог второй раз, и итог разошёлся бы с
// доходом — сервер отказал бы. Услуги записи с её «сверху» уже разложены
// на сумму до налога (`generate`), им режим записи.
export function initialInvoiceVatMode({
  existing,
  incomeAmount,
  hasSourceAppointment,
  appointmentVat,
  seedVatMode,
  seeded,
}: {
  existing: InvoiceLedgerWithLines | null | undefined;
  incomeAmount: number | null;
  hasSourceAppointment: boolean;
  appointmentVat: AppointmentVat | null;
  seedVatMode: InvoiceVatMode;
  /** The form was generated from the source visit. */
  seeded: boolean;
}): InvoiceVatMode {
  // У счетов до колонки режима (20260915120000) он пуст — восстанавливаем
  // по суммам, как бумага, а не угадываем «в цене».
  if (existing) return invoiceVatMode(existing);
  // ИНВОЙС НА ПОЛУЧЕННЫЕ ДЕНЬГИ ЗАПИСИ — С ЕЁ НАЛОГОМ (04.10): у записи без
  // VAT его нет и в инвойсе. Налог команды «сверху» насчитывал €55,93 на
  // полученные €47, и выставить было нельзя.
  if (incomeAmount != null && hasSourceAppointment && !appointmentVat) return "off";
  const mode = appointmentVat?.mode ?? seedVatMode;
  return incomeAmount != null && !seeded && mode === "exclusive" ? "inclusive" : mode;
}

/** Discount in money off `linesSum`; nothing typed or not a number — 0. */
export function discountAmountOf(linesSum: number, kind: DiscountKind, value: string): number {
  const discountNumber = Number(value.replace(",", "."));
  return Number.isFinite(discountNumber) && discountNumber > 0
    ? round2(linesSum - applyDiscount(linesSum, { type: kind, value: discountNumber }))
    : 0;
}

export type InvoiceReason = { text: string; error: boolean } | null;

export function invoiceReason({
  lines,
  parsedLines,
  total,
  rate,
  incomeAmount,
  currency,
  owner,
  companiesLoaded,
  pickedCompany,
  vatMode,
}: {
  lines: EditableInvoiceLine[];
  parsedLines: InvoiceLineDraft[];
  total: number;
  rate: number;
  incomeAmount: number | null;
  currency: string;
  owner: boolean;
  /** The companies directory has arrived. */
  companiesLoaded: boolean;
  pickedCompany: Pick<
    Company,
    "is_default" | "archived_at" | "legal_name" | "vat_number" | "business_address"
  > | null;
  vatMode: InvoiceVatMode;
}): InvoiceReason {
  const noPrice = parsedLines.every((line) => line.unit_price < 0);
  const noTitle = parsedLines.every((line) => !line.title);
  return noPrice && noTitle && total <= 0
    ? { text: "Заполните услугу: что и за сколько", error: false }
    : noPrice && total <= 0
      ? { text: "Укажите цену услуги", error: false }
    // СВОЮ УСЛУГУ ЕЩЁ ДОПИСЫВАЮТ — это подсказка, а не ошибка: строка
    // только что добавлена «＋ Добавить», и красный текст под пустыми
    // полями ругал человека за то, что он не успел напечатать.
    : lines.some(
          (line) =>
            !line.serviceId
            && (!line.title.trim() || parseMoneyAmount(line.unitPrice) == null),
        )
      ? { text: "Допишите свою услугу: название и цену", error: false }
    : parsedLines.some(
          (line) => !line.title || line.qty <= 0 || line.unit_price < 0,
        )
      ? {
          text: "Проверьте название, количество и цену каждой услуги",
          error: true,
        }
      : // СТАВКУ БОЛЬШЕ НЕ ВВОДЯТ РУКАМИ, НО СЕРВЕР ЕЁ ВСЁ РАВНО ПРОВЕРЯЕТ:
        // настройка команды могла прийти испорченной, и молча выставить по
        // ней документ нельзя.
        rate < 0 || rate > 100
        ? {
            text: "Ставка VAT должна быть от 0 до 100% — поправьте её в настройках",
            error: true,
          }
        : total <= 0
          ? { text: "Итог инвойса должен быть больше нуля", error: true }
          : incomeAmount != null && round2(total) !== incomeAmount
            ? {
                text: `Итог должен совпадать с доходом — ${formatInvoiceMoney(incomeAmount, currency)}`,
                error: true,
              }
            // БЕЗ РЕКВИЗИТОВ ИНВОЙС НЕ ВЫСТАВЛЯЕТСЯ (аудит 2026-09-29:
            // документ уходил с шапкой «Giliuta» без адреса и VAT-номера).
            // Ведём туда, где их заполняют: блок «Реквизиты» этой же формы
            // открывает набор тапом. Пока справочник не доехал — не судим.
            : owner && companiesLoaded && (!pickedCompany || !companyFilled(pickedCompany))
              ? {
                  text: "Заполните реквизиты — тапните блок «Реквизиты» выше",
                  error: false,
                }
              // VAT НАЧИСЛЯЕТ ТОЛЬКО ЮРЛИЦО С VAT-НОМЕРОМ — правило
              // `issue_invoice`. Без этой строки реквизиты с одним адресом
              // проходили, а выпуск молча отказывал (аудит 03.10).
              : owner && vatMode !== "off" && rate > 0 && pickedCompany && !pickedCompany.vat_number?.trim()
                ? {
                    text: "Для VAT впишите VAT-номер в реквизитах — тапните блок «Реквизиты» выше",
                    error: false,
                  }
                : null;
}
