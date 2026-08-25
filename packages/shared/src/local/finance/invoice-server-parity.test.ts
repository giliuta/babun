import { describe, expect, test } from "bun:test";

import {
  calculateInvoiceTotals,
  invoiceLineTotal,
  splitVatInclusive,
  type InvoiceVatMode,
} from "./invoice-ledger";
import { applyTxVat, grossFromNet, netFromGross, vatFromGross } from "./vat";

// ПРИЁМКА ДЕНЕЖНОЙ АРИФМЕТИКИ: КЛИЕНТ СЧИТАЕТ РОВНО ТО ЖЕ, ЧТО СЕРВЕР.
//
// Инвойс выставляет серверная функция, а клиент считает те же суммы дважды:
// показывает их человеку ДО отправки и сверяет контрольным чтением ПОСЛЕ.
// Расхождение в один цент — это не «косметика»: документ уже создан, номер
// израсходован, а выставление падает с ошибкой.
//
// Здесь эталон сервера построен НЕЗАВИСИМО от прод-кода — на BigInt, прямо по
// тексту SQL (`supabase/migrations/20260720210005_invoice_partial_payments.sql`,
// функции `issue_invoice` и `update_invoice_draft`):
//
//   line_total  := round(qty * unit_price, 2)
//   base_total  := round(сумма строк, 2)
//   inclusive   → vat := round(base − base / (1 + rate/100), 2); net := base − vat
//   exclusive   → vat := round(base * rate / 100, 2); total := base + vat
//
// `numeric` считает точно и округляет ПОЛОВИНУ ОТ НУЛЯ, поэтому эталон живёт в
// целых центах. Прод-код обязан совпасть с ним на КАЖДОЙ точке сетки.

/** round(a / b, 0) половиной от нуля — правило `round()` в Postgres. */
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** `round(qty * unit_price, 2)` на numeric, в центах. */
function serverLineCents(qty: number, unitPrice: number): bigint {
  // qty ≤ 3 знаков, цена ≤ 2 знаков — те же пределы стережёт сервер,
  // поэтому оба числа переводятся в целые без потери точности.
  const qtyThousandths = BigInt(Math.round(qty * 1000));
  const priceCents = BigInt(Math.round(unitPrice * 100));
  return roundHalfAwayFromZero(qtyThousandths * priceCents, 1000n);
}

/** Итоги документа так, как их посчитает и запишет SQL. */
function serverTotalsCents(
  lines: readonly { qty: number; unit_price: number }[],
  vatMode: InvoiceVatMode,
  vatPercent: number,
): { net: bigint; vat: bigint; total: bigint } {
  const base = lines.reduce(
    (sum, line) => sum + serverLineCents(line.qty, line.unit_price),
    0n,
  );
  const rate = BigInt(Math.round(vatPercent * 100));
  if (vatMode === "off" || rate <= 0n) return { net: base, vat: 0n, total: base };
  if (vatMode === "inclusive") {
    // base − base / (1 + rate/100) = base * rate / (100 + rate).
    const vat = roundHalfAwayFromZero(base * rate, 10_000n + rate);
    return { net: base - vat, vat, total: base };
  }
  const vat = roundHalfAwayFromZero(base * rate, 10_000n);
  return { net: base, vat, total: base + vat };
}

function cents(value: number): number {
  return Math.round(value * 100);
}

const RATES = [19, 20, 24];
// Дробные количества — штатные с приходом единицы измерения («4 м», «2,5 ч»),
// и именно на них double промахивается мимо numeric.
const QUANTITIES = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.33, 4, 7.25, 12.5];

describe("итог позиции = round(qty * unit_price, 2) на сервере", () => {
  test("известные точки расхождения double и numeric", () => {
    expect(invoiceLineTotal(1.5, 2.01)).toBe(3.02);
    expect(invoiceLineTotal(1.5, 2.07)).toBe(3.11);
    expect(invoiceLineTotal(1.5, 2.15)).toBe(3.23);
    expect(invoiceLineTotal(1.5, 2.51)).toBe(3.77);
  });

  test("целые количества не поехали: 2 × 50, 1 × 19, 3 × 33,33", () => {
    expect(invoiceLineTotal(2, 50)).toBe(100);
    expect(invoiceLineTotal(1, 19)).toBe(19);
    expect(invoiceLineTotal(3, 33.33)).toBe(99.99);
  });

  test("цена с третьим знаком (превью до валидатора) округляется до цента", () => {
    expect(invoiceLineTotal(1, 0.333)).toBe(0.33);
  });

  test("итог позиции виден один и тот же везде", () => {
    // Подытог документа собирается ИЗ ЭТОЙ ЖЕ функции, поэтому карточка
    // позиции, лист позиции, бумага и шапка обязаны показать одно число.
    expect(
      calculateInvoiceTotals([{ title: "Труба", qty: 1.5, unit_price: 2.01 }], "off", 0),
    ).toEqual({ subtotal_net: 3.02, vat_amount: 0, total: 3.02 });
    expect(
      calculateInvoiceTotals(
        [
          { title: "Труба", qty: 1.5, unit_price: 2.01 },
          { title: "Кабель", qty: 1.5, unit_price: 2.07 },
        ],
        "off",
        0,
      ).total,
    ).toBe(6.13);
  });

  test("сетка количеств × цен совпадает с сервером всюду", () => {
    for (const qty of QUANTITIES) {
      for (let priceCents = 1; priceCents <= 5000; priceCents++) {
        const unitPrice = priceCents / 100;
        expect(cents(invoiceLineTotal(qty, unitPrice))).toBe(
          Number(serverLineCents(qty, unitPrice)),
        );
      }
    }
  });
});

describe("итоги документа = расчёт issue_invoice / update_invoice_draft", () => {
  test("одна позиция: сетка сумм × ставок × режимов", () => {
    for (const vatMode of ["off", "inclusive", "exclusive"] as const) {
      for (const rate of RATES) {
        for (let priceCents = 1; priceCents <= 20_000; priceCents++) {
          const lines = [
            { title: "Работа", qty: 1, unit_price: priceCents / 100 },
          ];
          const actual = calculateInvoiceTotals(lines, vatMode, rate);
          const expected = serverTotalsCents(lines, vatMode, rate);
          expect(cents(actual.subtotal_net)).toBe(Number(expected.net));
          expect(cents(actual.vat_amount)).toBe(Number(expected.vat));
          expect(cents(actual.total)).toBe(Number(expected.total));
        }
      }
    }
  });

  test("дробные количества в обоих режимах НДС", () => {
    for (const vatMode of ["inclusive", "exclusive"] as const) {
      for (const rate of RATES) {
        for (const qty of QUANTITIES) {
          for (let priceCents = 1; priceCents <= 1500; priceCents++) {
            const lines = [
              { title: "Труба", qty, unit_price: priceCents / 100 },
            ];
            const actual = calculateInvoiceTotals(lines, vatMode, rate);
            const expected = serverTotalsCents(lines, vatMode, rate);
            expect(cents(actual.subtotal_net)).toBe(Number(expected.net));
            expect(cents(actual.vat_amount)).toBe(Number(expected.vat));
            expect(cents(actual.total)).toBe(Number(expected.total));
          }
        }
      }
    }
  });

  test("многострочный документ: сервер складывает УЖЕ округлённые строки", () => {
    for (const vatMode of ["off", "inclusive", "exclusive"] as const) {
      for (const rate of RATES) {
        for (let priceCents = 1; priceCents <= 900; priceCents++) {
          const lines = [
            { title: "Труба", qty: 1.5, unit_price: priceCents / 100 },
            { title: "Кабель", qty: 3.33, unit_price: (priceCents + 7) / 100 },
            { title: "Работа", qty: 0.25, unit_price: (priceCents * 3) / 100 },
          ];
          const actual = calculateInvoiceTotals(lines, vatMode, rate);
          const expected = serverTotalsCents(lines, vatMode, rate);
          expect(cents(actual.subtotal_net)).toBe(Number(expected.net));
          expect(cents(actual.vat_amount)).toBe(Number(expected.vat));
          expect(cents(actual.total)).toBe(Number(expected.total));
          // Сумма строк документа = его итог до НДС: печатная бумага не
          // имеет права разойтись с шапкой.
          const printed = lines.reduce(
            (sum, line) => sum + cents(invoiceLineTotal(line.qty, line.unit_price)),
            0,
          );
          const base = vatMode === "inclusive"
            ? cents(actual.total)
            : cents(actual.subtotal_net);
          expect(printed).toBe(base);
        }
      }
    }
  });
});

// НДС ОПЕРАЦИИ СЧИТАЕТ ТОТ ЖЕ КАМЕНЬ. Триггер `fill_transaction_vat` пишет
// `round(amount * rate / (100 + rate), 2)` — та же формула, что у инвойса
// «включено». Разъезд означал бы, что запись, инвойс и чек говорят разное.
describe("паритет vat.ts с сервером и с инвойсом", () => {
  test("налог внутри валовой суммы", () => {
    for (const rate of RATES) {
      for (let amountCents = 1; amountCents <= 20_000; amountCents++) {
        const gross = amountCents / 100;
        const expectedVat = roundHalfAwayFromZero(
          BigInt(amountCents) * BigInt(rate * 100),
          10_000n + BigInt(rate * 100),
        );
        expect(cents(vatFromGross(gross, rate))).toBe(Number(expectedVat));
        expect(cents(netFromGross(gross, rate))).toBe(
          amountCents - Number(expectedVat),
        );
        // Инвойс «включено» и операция «НДС включён» — одно число.
        const { net, vat } = splitVatInclusive(gross, rate);
        const tx = applyTxVat(gross, "inclusive", rate);
        expect(vat).toBe(tx.vat);
        expect(net).toBe(tx.net);
      }
    }
  });

  test("налог сверху цены: «плюс НДС» = exclusive у инвойса", () => {
    for (const rate of RATES) {
      for (let amountCents = 1; amountCents <= 20_000; amountCents++) {
        const net = amountCents / 100;
        const expectedVat = roundHalfAwayFromZero(
          BigInt(amountCents) * BigInt(rate * 100),
          10_000n,
        );
        expect(cents(grossFromNet(net, rate))).toBe(
          amountCents + Number(expectedVat),
        );
        const totals = calculateInvoiceTotals(
          [{ title: "Работа", qty: 1, unit_price: net }],
          "exclusive",
          rate,
        );
        expect(cents(totals.vat_amount)).toBe(Number(expectedVat));
        expect(cents(totals.total)).toBe(amountCents + Number(expectedVat));
        // Валовая сумма операции «плюс НДС» и итог инвойса — одно число:
        // иначе счёт и проводка по одной работе разойдутся на цент.
        expect(applyTxVat(net, "exclusive", rate).gross).toBe(totals.total);
      }
    }
  });
});
