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

const PRINT_TIMEOUT_MS = 60_000;

/** Обещание с пределом: не дождались — ошибка с `message`, а не вечное ожидание. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

type PdfModules = {
  Print: typeof import("expo-print");
  Sharing: typeof import("expo-sharing");
  FileSystem: typeof import("expo-file-system");
};

async function pdfModules(): Promise<PdfModules> {
  try {
    const [Print, Sharing, FileSystem] = await Promise.all([
      import("expo-print"),
      import("expo-sharing"),
      import("expo-file-system"),
    ]);
    return { Print, Sharing, FileSystem };
  } catch {
    throw new Error(
      "PDF-модуль ещё не установлен в текущую сборку приложения. Обновите приложение и попробуйте снова.",
    );
  }
}

/** HTML → файл PDF под человеческим именем. */
async function printToNamedFile(html: string, fileName: string): Promise<string> {
  const { Print, FileSystem } = await pdfModules();
  let uri: string;
  try {
    // ПРЕДЕЛ ОЖИДАНИЯ. Печать идёт в скрытом WebView; на Android она
    // однажды не вернулась вовсе (когда приложение открыто ссылкой снаружи), и
    // кнопка крутилась без конца. Через минуту человек получает
    // понятную ошибку и может нажать ещё раз.
    const result = await withTimeout(
      Print.printToFileAsync({
        html,
        width: 595,
        height: 842,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      PRINT_TIMEOUT_MS,
      "PDF собирался слишком долго.",
    );
    uri = result.uri;
  } catch (error) {
    throw new Error(`Не удалось создать PDF. ${errorMessage(error)}`);
  }
  // ИМЯ ФАЙЛА ЧИТАЕТ КЛИЕНТ, А НЕ МЫ. `printToFileAsync` кладёт PDF под
  // случайным UUID, и в WhatsApp уезжает «9B4FE7E6-FEC4…pdf» — документ без
  // имени. Переносим его рядом с понятным именем; если перенос не удался,
  // отправляем как есть: имя — удобство, а не условие отправки.
  return renameForHuman(FileSystem, uri, fileName);
}

/** ГОТОВЫЙ PDF — ОДИН, ПОСЛЕДНИЙ. Печать в скрытом WebView занимает секунды, и
 *  «Поделиться» инвойса ~5 с крутило спиннер до системного меню. Страница документа печатает его заранее (`preparePdf`), кнопка берёт
 *  готовый файл. Запись одна: файл лежит под именем документа, и вторая
 *  печать с тем же именем заменила бы его на диске — ключ «имя + HTML»
 *  тогда указывал бы на чужое содержимое. */
let prepared: { key: string; uri: Promise<string> } | null = null;

function preparedFile(html: string, fileName: string): Promise<string> {
  const key = `${fileName}\n${html}`;
  if (prepared?.key === key) return prepared.uri;
  const uri = printToNamedFile(html, fileName);
  const entry = { key, uri };
  prepared = entry;
  // Не вышло — следующая попытка печатает заново, а не повторяет ошибку.
  uri.catch(() => {
    if (prepared === entry) prepared = null;
  });
  return uri;
}

/** Напечатать PDF заранее, пока человек смотрит документ. Ошибки молчат —
 *  их скажет само «Поделиться», если до него дойдёт. Веб печатает сам
 *  документ по нажатию, готовить ему нечего. */
export function preparePdf({ html, fileName }: Pick<SharePdfInput, "html" | "fileName">): void {
  if (typeof document !== "undefined") return;
  preparedFile(html, fileName).catch(() => {});
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

  const { Sharing, FileSystem } = await pdfModules();
  let sendUri = await preparedFile(html, fileName);
  // Заготовку мог стереть сам iOS (это кэш) — тогда печатаем заново.
  if (!fileExists(FileSystem, sendUri)) {
    prepared = null;
    sendUri = await preparedFile(html, fileName);
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("PDF создан, но системное меню экспорта на этом устройстве недоступно.");
  }
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

function fileExists(FileSystem: typeof import("expo-file-system"), uri: string): boolean {
  try {
    return new FileSystem.File(uri).exists;
  } catch {
    // Не смогли спросить — считаем, что файл на месте: ответит само меню.
    return true;
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
