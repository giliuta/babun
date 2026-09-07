// ЧИСТАЯ ЧАСТЬ СКАНЕРА (без React Native и Expo — тестируется под node):
// разметка PDF из страниц и имя файла. Нативная часть — document-scanner.ts.

/** A4 в пунктах 72 PPI. Каждая страница — своя страница PDF, картинка вписана. */
export const A4 = { width: 595, height: 842 };

export function pagesHtml(pages: readonly string[]): string {
  const body = pages
    .map(
      (b64) =>
        `<div style="page-break-after:always;width:${A4.width}px;height:${A4.height}px;display:flex;align-items:center;justify-content:center;overflow:hidden">` +
        `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%;max-height:100%;object-fit:contain" /></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${body}</body></html>`;
}

/** «Скан 06.09 18-47.pdf» — имя видно во вложениях клиента, точки в имени
 *  файла не рвут расширение, поэтому время через дефис. */
export function scanFileName(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Скан ${p(at.getDate())}.${p(at.getMonth() + 1)} ${p(at.getHours())}-${p(at.getMinutes())}.pdf`;
}

