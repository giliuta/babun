/** RFC-4180-compatible cell for a semicolon-delimited regional CSV file. */
export function csvCell(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text === "") return "";
  if (/[";,\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Keep user-controlled spreadsheet values as text. Excel and Numbers may
 * execute a CSV cell beginning with =, +, -, or @ as a formula.
 */
export function csvTextCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const safe = /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return csvCell(safe);
}

/** UTF-8 BOM + CRLF makes Cyrillic and regional CSV open reliably in Excel. */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return `\uFEFF${rows.map((row) => row.join(";")).join("\r\n")}`;
}

/** Имя файла считается ОДИН раз на обе платформы — иначе выгрузка из
 *  браузера и с телефона называлась бы по-разному. */
function csvFilename(raw: string): string {
  const safeName = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return safeName.toLowerCase().endsWith(".csv") ? safeName : `${safeName}.csv`;
}

export async function shareCsvFile(input: {
  contents: string;
  filename: string;
  dialogTitle: string;
}): Promise<void> {
  const filename = csvFilename(input.filename);

  // БРАУЗЕР — обычное скачивание файла.
  //
  // Нативный путь тут не работает вовсе: expo-sharing на вебе отвечает
  // `!!navigator.share`, то есть «нет» в любом настольном Chrome/Firefox, а
  // expo-file-system пишет в другую файловую систему. Выгрузка бухгалтеру —
  // как раз настольный сценарий, ради которого веб и открывают.
  //
  // Платформу определяем по DOM, а не по Platform.OS: верхнеуровневый импорт
  // react-native уронил бы `bun test` в трёх файлах, которые тянут этот
  // модуль (bun не разбирает Flow в исходниках RN).
  if (
    typeof document !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    const href = URL.createObjectURL(
      new Blob([input.contents], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      // ОТЗЫВАЕМ ССЫЛКУ СЛЕДУЮЩИМ ТИКОМ, А НЕ СРАЗУ.
      //
      // `a.click()` только СТАВИТ скачивание в очередь; читать blob браузер
      // идёт уже после текущей задачи. Синхронный revokeObjectURL забирал
      // адрес раньше, чем Firefox и Safari успевали за ним прийти, и файл
      // не скачивался вовсе — ровно то самое «кнопка молчит», ради которого
      // веб-ветка и появилась. Без revoke совсем нельзя: ссылка держала бы
      // весь CSV в памяти вкладки до перезагрузки.
      setTimeout(() => URL.revokeObjectURL(href), 0);
    }
    return;
  }

  let FileSystem: typeof import("expo-file-system");
  let Sharing: typeof import("expo-sharing");

  try {
    [FileSystem, Sharing] = await Promise.all([
      import("expo-file-system"),
      import("expo-sharing"),
    ]);
  } catch {
    throw new Error(
      "Модуль экспорта ещё не установлен в текущую сборку. Обновите iOS-приложение и попробуйте снова.",
    );
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Системное меню экспорта на этом устройстве недоступно.");
  }

  const file = new FileSystem.File(FileSystem.Paths.cache, filename);

  try {
    file.create({ overwrite: true });
    file.write(input.contents, { encoding: "utf8" });
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
      dialogTitle: input.dialogTitle,
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new Error(`Не удалось создать или отправить CSV.${detail}`);
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // A stale cache file is harmless; cleanup must not mask a successful
      // system share operation.
    }
  }
}
