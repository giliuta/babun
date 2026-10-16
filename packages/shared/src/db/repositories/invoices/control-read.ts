// Post-write check: the committed invoice must match the sent draft.

import type {
  InvoiceLedgerWithLines,
  InvoiceLineDraft,
  InvoiceVatMode,
} from "../../../local/finance/invoice-ledger";
import { invoiceLineTotal } from "../../../local/finance/invoice-ledger";
import { roundInvoiceMoney } from "../invoice-write-helpers";

export function assertInvoiceControlRead(
  saved: InvoiceLedgerWithLines,
  lines: InvoiceLineDraft[],
  totals: { subtotal_net: number; vat_amount: number; total: number },
  expected: {
    issuedOn: string;
    dueOn: string | null;
    clientId: string | null;
    appointmentId: string | null;
    brigadeId: string | null;
    notes: string | null;
    vatMode: InvoiceVatMode;
    vatPercent: number;
    // Необязательны, потому что `null` здесь значит «человек не выбирал»:
    // сервер тогда подставляет ОСНОВНОЙ набор реквизитов (`resolve_company_id`),
    // и сверять `null` с подставленным нельзя — сверка пропускается, см. ниже.
    companyId?: string | null;
    accountId?: string | null;
    allowResolvedReferences: boolean;
  },
): void {
  const expectedVat = expected.vatMode === "off"
    ? 0
    : roundInvoiceMoney(expected.vatPercent);
  const headerMatches =
    saved.issued_on === expected.issuedOn &&
    saved.due_on === expected.dueOn &&
    saved.notes === (expected.notes?.trim() || null) &&
    moneyEqual(saved.subtotal_net, totals.subtotal_net) &&
    moneyEqual(saved.vat_amount, totals.vat_amount) &&
    moneyEqual(saved.total, totals.total) &&
    moneyEqual(saved.vat_percent, expectedVat);
  const referencesMatch = expected.allowResolvedReferences
    ? (expected.clientId === null || saved.client_id === expected.clientId) &&
      (expected.appointmentId === null || saved.appointment_id === expected.appointmentId) &&
      (expected.brigadeId === null || saved.brigade_id === expected.brigadeId)
    : saved.client_id === expected.clientId &&
      saved.appointment_id === expected.appointmentId &&
      saved.brigade_id === expected.brigadeId;
  // РЕКВИЗИТЫ И СЧЁТ СВЕРЯЮТСЯ, ТОЛЬКО КОГДА ЧЕРНОВИК ИХ ВЫБРАЛ. `null`
  // здесь не значит «пусто в базе»: сервер вправе подставить основной набор
  // реквизитов сам (`resolve_company_id`), и сверка `null` с подставленным
  // значением ложно уронила бы правильно выставленный счёт.
  const requisitesMatch =
    (expected.companyId == null || saved.company_id === expected.companyId) &&
    (expected.accountId == null || saved.account_id === expected.accountId);
  const linesMatch =
    saved.lines.length === lines.length &&
    saved.lines.every((line, index) => {
      const expectedLine = lines[index];
      // ОПИСАНИЕ И ЕДИНИЦА СВЕРЯЮТСЯ НАРАВНЕ С ДЕНЬГАМИ. Сторож дописан
      // после инцидента, в котором сервер молча терял именно эти два поля,
      // и без них он по построению не мог поймать его повторение: суммы
      // сходятся, а к клиенту уезжает счёт без текста позиций.
      return line.position === index &&
        line.title === expectedLine.title &&
        line.description === (expectedLine.description ?? null) &&
        line.unit === (expectedLine.unit ?? null) &&
        Math.abs(line.qty - expectedLine.qty) < 0.0005 &&
        moneyEqual(line.unit_price, expectedLine.unit_price) &&
        // СТОРОЖ СЧИТАЕТ ТЕМ ЖЕ СПОСОБОМ, ЧТО И СЕРВЕР. Своё
        // `qty * unit_price` в double расходилось с `round(qty * unit_price, 2)`
        // на numeric ровно на цент (1,5 × €2,01 — 3,01 против 3,02), и сторож
        // ронял ПРАВИЛЬНО записанный документ: инвойс создан, номер
        // израсходован, а человек видит ошибку выставления.
        moneyEqual(
          line.total,
          invoiceLineTotal(expectedLine.qty, expectedLine.unit_price),
        );
    });

  if (!headerMatches || !referencesMatch || !requisitesMatch || !linesMatch) {
    throw new Error(
      "Контрольное чтение инвойса не совпало с отправленным документом",
    );
  }
}

function moneyEqual(left: number, right: number): boolean {
  return Math.abs(roundInvoiceMoney(left) - roundInvoiceMoney(right)) < 0.005;
}
