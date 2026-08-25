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
  // БРАУЗЕР — печать САМОГО инвойса, до любых импортов expo.
  //
  // Веб-реализация expo-print — это `async printToFileAsync() { window.print(); }`:
  // переданный html она игнорирует и ничего не возвращает. На бумагу уходил
  // текущий экран CRM (список, шапка, таб-бар), а потом `result.uri` падал с
  // TypeError и превращался в немую ошибку. Ветка стоит ПЕРВОЙ строкой, чтобы
  // веб-бандл вообще не тянул expo-print/expo-sharing.
  if (typeof document !== "undefined") {
    printHtmlInIframe(
      buildInvoicePdfHtml(input),
      `Инвойс ${input.invoice.number}`,
    );
    return;
  }

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

/** Печать одного документа, не трогая страницу приложения.
 *
 *  Не `window.open`: функция вызывается из асинхронного обработчика, а окно,
 *  открытое вне синхронного стека жеста, срежет блокировщик — и человек снова
 *  получит тишину. Скрытый одноисточниковый iframe с `srcdoc` таким правилам
 *  не подчиняется. `buildInvoicePdfHtml` для этого и годится: это чистая
 *  строка со своим CSS, без react-native и expo внутри. */
function printHtmlInIframe(html: string, title: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.title = title;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    win.focus();
    win.print();
    // Снимаем ПОСЛЕ печати: удалённый iframe уносит с собой и диалог. В
    // Safari print() возвращается сразу, поэтому ждём событие, а таймер —
    // страховка на браузеры, которые его не шлют.
    const drop = () => frame.remove();
    win.addEventListener("afterprint", drop, { once: true });
    setTimeout(drop, 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Попробуйте ещё раз.";
}
