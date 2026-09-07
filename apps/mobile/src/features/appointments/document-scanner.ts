import { TurboModuleRegistry } from "react-native";
import * as Print from "expo-print";
import { A4, pagesHtml, scanFileName } from "./scan-pdf";

export { pagesHtml, scanFileName } from "./scan-pdf";

// СКАНЕР ДОКУМЕНТОВ (STORY-070, этап 2). Владелец: «сразу автоматически сканер
// документа могли сделать». iOS — VisionKit: сам находит края, выравнивает,
// несколько страниц за раз. Страницы собираются в ОДИН PDF (`expo-print`) и
// уезжают документом записи — во вложения клиента с меткой записи.
//
// МОДУЛЬ НАТИВНЫЙ И МОЖЕТ ОТСУТСТВОВАТЬ: пакет при импорте зовёт
// `TurboModuleRegistry.getEnforcing` и роняет бандл там, где dev-клиент собран
// без него (соседний симулятор, старый TestFlight). Поэтому сперва спрашиваем
// реестр, и только потом требуем модуль; без него пункта «Отсканировать» в
// листе просто нет — мёртвых пунктов не держим.

type ScannerModule = {
  scanDocument: (options: {
    croppedImageQuality?: number;
    responseType?: "base64" | "imageFilePath";
  }) => Promise<{ scannedImages?: string[]; status?: "success" | "cancel" }>;
};

export function scannerAvailable(): boolean {
  try {
    return TurboModuleRegistry.get("DocumentScanner") != null;
  } catch {
    return false;
  }
}

function loadScanner(): ScannerModule | null {
  if (!scannerAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- условный нативный модуль
    const mod = require("react-native-document-scanner-plugin") as { default: ScannerModule };
    return mod.default;
  } catch {
    return null;
  }
}

/** Страницы скана как base64 JPEG. null — отменили или сканера нет. */
export async function scanDocumentPages(): Promise<string[] | null> {
  const scanner = loadScanner();
  if (!scanner) return null;
  const result = await scanner.scanDocument({ croppedImageQuality: 70, responseType: "base64" });
  if (result.status !== "success" || !result.scannedImages?.length) return null;
  return result.scannedImages;
}

export async function pagesToPdf(pages: readonly string[]): Promise<{ uri: string; fileName: string }> {
  const { uri } = await Print.printToFileAsync({ html: pagesHtml(pages), width: A4.width, height: A4.height });
  return { uri, fileName: scanFileName() };
}
