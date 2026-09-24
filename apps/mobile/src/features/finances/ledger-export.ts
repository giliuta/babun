import {
  paymentMethodLabel,
  signedAmount,
  TX_TYPE_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { csvCell, csvDocument, csvTextCell, shareCsvFile } from "@/lib/share-csv";

// ВЫГРУЗКА ОПЕРАЦИЙ ДЛЯ БУХГАЛТЕРА (аудит финансов 2026-09-24).
//
// Бухгалтер и VAT-декларация живут в таблице, а не в приложении: за квартал
// ему нужен список движений денег с датой, суммой, налогом, счётом и
// категорией. Раньше его было взять неоткуда, кроме скриншотов.
//
// Формат — тот же, что у выгрузки клиентов (`share-csv`): `;`, BOM, CRLF —
// так Excel с кипрской/русской локалью открывает файл сразу. Суммы — ЧИСЛАМИ
// с десятичной запятой и знаком («-55,00»), а не строками «−€55»: бухгалтер
// их складывает. Текст пользователя (заметки, имена) экранируется от формул.
//
// Строка — одна проводка журнала, как она лежит в базе: две ноги перевода —
// две строки (+ и −), возврат — отдельной строкой со знаком минус. Склеивать
// здесь нельзя: бухгалтер сверяет выписку банка построчно.

export interface LedgerExportRefs {
  accounts: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  clients: readonly { id: string; full_name: string }[];
  teams: readonly { id: string; name: string }[];
}

const HEADER = [
  "Дата",
  "Время",
  "Вид",
  "Сумма",
  "VAT",
  "Ставка VAT",
  "Счёт",
  "Категория",
  "Клиент",
  "Команда",
  "Способ оплаты",
  "Заметка",
] as const;

/** «-55,00» — число с десятичной запятой: Excel в локали CY/RU считает его. */
export function csvAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  // Без кавычек: разделитель — «;», и запятая в числе ничего не ломает, а
  // в кавычках часть программ читает сумму текстом. Внутри только цифры,
  // запятая и минус — экранировать нечего.
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** «24.09.2026» — так дату читает Excel в европейской локали. */
function csvDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

export function ledgerToCsv(
  transactions: readonly FinanceTransaction[],
  refs: LedgerExportRefs,
): string {
  const name = <T extends { id: string }>(list: readonly T[], id: string | null, pick: (x: T) => string) =>
    (id ? list.find((x) => x.id === id) : undefined)
      ? pick(list.find((x) => x.id === id) as T)
      : "";
  // Старые даты сверху вниз: бухгалтер идёт по периоду от начала к концу.
  const sorted = [...transactions].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on)
      || (a.occurred_time ?? "").localeCompare(b.occurred_time ?? "")
      || a.created_at.localeCompare(b.created_at),
  );
  const rows: string[][] = [HEADER.map((h) => csvCell(h))];
  for (const tx of sorted) {
    // «Без VAT» нажато руками — снимку не верим (то же правило, что у отчёта
    // `summarizeVat`), колонка пустая.
    const vat = tx.vat_mode === "none" ? null : tx.vat_amount;
    const vatSigned =
      vat === null || vat === undefined
        ? null
        : tx.type === "expense"
          ? -Math.abs(vat)
          : tx.type === "refund"
            ? -Math.abs(vat)
            : vat;
    rows.push([
      csvCell(csvDate(tx.occurred_on)),
      csvCell(tx.occurred_time ?? ""),
      csvCell(TX_TYPE_LABEL[tx.type] ?? tx.type),
      csvAmount(signedAmount(tx)),
      csvAmount(vatSigned),
      csvCell(vat === null || vat === undefined || tx.vat_rate == null ? "" : `${tx.vat_rate}%`),
      csvTextCell(name(refs.accounts, tx.account_id, (a) => a.name)),
      csvTextCell(name(refs.categories, tx.category_id, (c) => c.name)),
      csvTextCell(name(refs.clients, tx.client_id, (c) => c.full_name)),
      csvTextCell(name(refs.teams, tx.team_id, (t) => t.name)),
      csvCell(paymentMethodLabel(tx.payment_method)),
      csvTextCell(tx.notes),
    ]);
  }
  return csvDocument(rows);
}

/** Файл в системное «Поделиться»: «operations-2026-07-01-2026-09-30.csv». */
export async function shareLedgerCsv(input: {
  transactions: readonly FinanceTransaction[];
  refs: LedgerExportRefs;
  from: string;
  to: string;
  title: string;
}): Promise<void> {
  await shareCsvFile({
    contents: ledgerToCsv(input.transactions, input.refs),
    filename: `operations-${input.from}-${input.to}.csv`,
    dialogTitle: `Операции · ${input.title}`,
  });
}
