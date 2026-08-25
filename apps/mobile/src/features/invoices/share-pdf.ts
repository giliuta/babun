import type { Client } from "@babun/shared/local/clients";
import type {
  InvoiceLedgerWithLines,
  InvoicePaymentLedger,
  InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/features/settings/tenant";
import { buildInvoicePdfHtml } from "./pdf";

export async function shareInvoicePdf(input: {
  invoice: InvoiceLedgerWithLines;
  tenant?: Tenant;
  client?: Client;
  settlement: InvoiceSettlement;
  payments: readonly InvoicePaymentLedger[];
  accountNames?: ReadonlyMap<string, string>;
  businessToday?: string;
}): Promise<void> {
  let Print: typeof import("expo-print");
  let Sharing: typeof import("expo-sharing");
  try {
    [Print, Sharing] = await Promise.all([
      import("expo-print"),
      import("expo-sharing"),
    ]);
  } catch {
    throw new Error(
      "PDF-модуль ещё не установлен в текущую сборку приложения. Обновите iOS-сборку и попробуйте снова.",
    );
  }

  let uri: string;
  try {
    const result = await Print.printToFileAsync({
      html: buildInvoicePdfHtml(input),
      width: 595,
      height: 842,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    uri = result.uri;
  } catch (error) {
    throw new Error(`Не удалось создать PDF. ${errorMessage(error)}`);
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("PDF создан, но системное меню экспорта на этом устройстве недоступно.");
  }
  try {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: `Инвойс ${input.invoice.number}`,
    });
  } catch (error) {
    throw new Error(`PDF создан, но открыть меню экспорта не удалось. ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Попробуйте ещё раз.";
}
