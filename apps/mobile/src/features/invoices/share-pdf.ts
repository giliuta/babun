import type { Client } from "@babun/shared/local/clients";
import type {
  InvoiceLedgerWithLines,
  InvoicePaymentLedger,
  InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/session/tenant";
import { invoiceDictionary, type InvoiceLanguage } from "@/lib/paper/dictionary";
import { shareHtmlAsPdf } from "@/lib/share-pdf";
import { buildInvoicePdfHtml } from "@/lib/paper/pdf";

// Печать — общий примитив `@/lib/share-pdf` (см. его
// комментарий: веб-iframe/`printToFileAsync`+`shareAsync`, один на продукт).
// Здесь остаётся только сборка HTML конкретного инвойса и имя, под которым
// он уходит наружу — поведение самой печати не менялось ни на шаг.
export async function shareInvoicePdf(input: {
  invoice: InvoiceLedgerWithLines;
  tenant?: Tenant;
  client?: Client;
  settlement: InvoiceSettlement;
  payments: readonly InvoicePaymentLedger[];
  accountNames?: ReadonlyMap<string, string>;
  businessToday?: string;
  /** ЯЗЫК ДОКУМЕНТА, А НЕ ЯЗЫК ПРИЛОЖЕНИЯ. Он выбран при выставлении и лежит
   *  в строке инвойса; сюда его обязан передать экран. Без него
   *  англичанин, которому счёт СОБИРАЛИ на английском, получил бы PDF
   *  «ИНВОЙС / Продавец / Получатель / К оплате». */
  language?: InvoiceLanguage;
  /** Кредит-нота: номер отменённого инвойса (см. `IssuedDocumentInput`). */
  creditNote?: { originalNumber: string | null } | null;
}): Promise<void> {
  const dict = invoiceDictionary(input.language);
  const title = `${input.creditNote ? dict.creditNoteEyebrow : dict.invoiceEyebrow} ${input.invoice.number}`;
  await shareHtmlAsPdf({
    html: buildInvoicePdfHtml(input),
    fileName: title,
    dialogTitle: title,
  });
}
