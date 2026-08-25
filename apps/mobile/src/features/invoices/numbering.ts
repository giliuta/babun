// НОМЕР ДОКУМЕНТА СОБИРАЕТСЯ ОДНОЙ ФОРМУЛОЙ.
//
// Настоящий номер выдаёт сервер (format_invoice_number в базе) — только он
// знает, какой счётчик занят. Здесь та же формула для ОБРАЗЦА в настройках:
// человек крутит «знаков в номере» и сразу видит, как это выглядит, не выставляя
// счёт. Разойтись они не должны, поэтому правило одно и записано дважды словами,
// а не двумя разными способами.

export interface InvoiceNumberParts {
  prefix: string;
  year: number;
  seq: number;
  padding: number;
  /** Год в номере и обнуление счётчика 1 января. */
  yearlyReset: boolean;
}

export function formatInvoiceNumber({
  prefix,
  year,
  seq,
  padding,
  yearlyReset,
}: InvoiceNumberParts): string {
  const letters = prefix.trim().replace(/[\s-]+$/, "") || "INV";
  // Ширина считается РОВНО как на сервере: greatest(coalesce(padding,3), 1) —
  // и без верхней границы. Кап `Math.min(8, …)` здесь стоял, а в SQL его нет:
  // экран настроек и так не даёт набрать больше восьми, но значение, записанное
  // вебом или прямым SQL, давало образец, не совпадающий с выданным номером, —
  // ровно то, что шапка этого файла запрещает.
  //
  // Третьего слагаемого сервера — `length(seq)` — здесь нет намеренно:
  // `padStart` короче строки не обрезает, то есть уже ведёт себя как greatest.
  const width = Math.max(1, Math.trunc(Number.isFinite(padding) ? padding : 3));
  const digits = String(Math.max(1, Math.trunc(seq))).padStart(width, "0");
  return yearlyReset ? `${letters}-${year}-${digits}` : `${letters}-${digits}`;
}
