import type { Client } from "@babun/shared/local/clients";
import type {
  InvoiceLedgerWithLines,
  InvoicePaymentLedger,
  InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/features/settings/tenant";
import type { InvoiceLanguage } from "./dictionary";
import { shareHtmlAsPdf } from "@/features/documents/share-pdf";
import { buildInvoicePdfHtml } from "./pdf";

// Печать — общий примитив `@/features/documents/share-pdf` (см. его
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
   *  в строке инвойса; сюда его обязан передать экран. Пока этого параметра
   *  не было, англичанин, которому счёт СОБИРАЛИ на английском, получал PDF
   *  «ИНВОЙС / Продавец / Получатель / К оплате» — аудит бумаги 2026-09-20. */
  language?: InvoiceLanguage;
}): Promise<void> {
  const title =
    input.language === "en"
      ? `Invoice ${input.invoice.number}`
      : `Инвойс ${input.invoice.number}`;
  await shareHtmlAsPdf({
    html: buildInvoicePdfHtml(input),
    fileName: title,
    dialogTitle: title,
  });
}
