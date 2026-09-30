// ОБЩИЙ ПРИМИТИВ ПЕЧАТИ — ОДИН НА ПРОДУКТ.
//
// «HTML → PDF → системное меню „Поделиться―» раньше жила только у инвойса
// (`src/features/invoices/share-pdf.ts`), а теперь её просит второй документ —
// чек. Второй копии печати в продукте быть не должно (AGENTS.md «БЕРИ
// ГОТОВОЕ, НЕ ПИШИ ВТОРОЕ»): модель документа и разметка HTML остаются у
// каждого документа своими, общая только механика превращения готовой
// строки в файл и системное меню экспорта.
//
// Веб печатает через скрытый iframe и НЕ трогает expo-print: веб-реализация
// `printToFileAsync` — это `window.print()`, которая переданный html
// игнорирует и печатает текущий экран CRM. Нативно — `expo-print` +
// `expo-sharing`, оба модуля подключаются динамически и в try/catch: сборки
// на руках у людей бывают старше package.json.

export interface SharePdfInput {
  html: string;
  /** Имя документа: заголовок печатаемого окна/вкладки на вебе. */
  fileName: string;
  /** Заголовок системного диалога «Поделиться» на нативе. */
  dialogTitle: string;
}

export async function shareHtmlAsPdf({
  html,
  fileName,
  dialogTitle,
}: SharePdfInput): Promise<void> {
  // БРАУЗЕР — печать САМОГО документа, до любых импортов expo. Ветка стоит
  // ПЕРВОЙ строкой, чтобы веб-бандл вообще не тянул expo-print/expo-sharing.
  if (typeof document !== "undefined") {
    printHtmlInIframe(html, fileName);
    return;
  }

  let Print: typeof import("expo-print");
  let Sharing: typeof import("expo-sharing");
  let FileSystem: typeof import("expo-file-system");
  try {
    [Print, Sharing, FileSystem] = await Promise.all([
      import("expo-print"),
      import("expo-sharing"),
      import("expo-file-system"),
    ]);
  } catch {
    throw new Error(
      "PDF-модуль ещё не установлен в текущую сборку приложения. Обновите iOS-сборку и попробуйте снова.",
    );
  }

  let uri: string;
  try {
    const result = await Print.printToFileAsync({
      html,
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
  // ИМЯ ФАЙЛА ЧИТАЕТ КЛИЕНТ, А НЕ МЫ. `printToFileAsync` кладёт PDF под
  // случайным UUID, и в WhatsApp уезжает «9B4FE7E6-FEC4…pdf» — документ без
  // имени. Переносим его рядом с понятным именем; если перенос не удался,
  // отправляем как есть: имя — удобство, а не условие отправки.
  const sendUri = renameForHuman(FileSystem, uri, fileName);
  try {
    await Sharing.shareAsync(sendUri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle,
    });
  } catch (error) {
    throw new Error(`PDF создан, но открыть меню экспорта не удалось. ${errorMessage(error)}`);
  }
}

/** Кладёт готовый PDF рядом под человеческим именем и отдаёт его адрес.
 *  Имя чистится от того, чем файловая система подавится. */
function renameForHuman(
  FileSystem: typeof import("expo-file-system"),
  uri: string,
  fileName: string,
): string {
  try {
    const safe =
      fileName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() ||
      "Документ";
    const named = new FileSystem.File(FileSystem.Paths.cache, `${safe}.pdf`);
    if (named.exists) named.delete();
    new FileSystem.File(uri).move(named);
    return named.uri;
  } catch {
    return uri;
  }
}

/** Печать одного документа, не трогая страницу приложения.
 *
 *  Не `window.open`: функция вызывается из асинхронного обработчика, а окно,
 *  открытое вне синхронного стека жеста, срежет блокировщик — и человек снова
 *  получит тишину. Скрытый одноисточниковый iframe с `srcdoc` таким правилам
 *  не подчиняется. Готовый HTML для этого и годится: чистая строка со своим
 *  CSS, без react-native и expo внутри. */
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
