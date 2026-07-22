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

export async function shareCsvFile(input: {
  contents: string;
  filename: string;
  dialogTitle: string;
}): Promise<void> {
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

  const safeName = input.filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
  const filename = safeName.toLowerCase().endsWith(".csv")
    ? safeName
    : `${safeName}.csv`;
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
