import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import {
  PAYMENT_METHOD_LABEL,
  signedAmount,
  TX_TYPE_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import { csvCell, csvDocument, csvTextCell } from "@/lib/share-csv";
import type { AccountPeriodSummary } from "./account-period";
import { accountPeriodClosing } from "./account-period";

// Три клавиши операции человеческими словами: бухгалтер должен видеть, как
// назначали налог, а не догадываться по сумме.
const VAT_MODE_LABEL: Record<string, string> = {
  none: "Без НДС",
  inclusive: "НДС включён",
  exclusive: "Плюс НДС",
};

export interface CsvLookups {
  /** id команды → имя; NULL team_id печатается как «Компания». */
  teamName?: ReadonlyMap<string, string>;
  accounts?: readonly Pick<Account, "id" | "name">[];
}

/** Копейки без хвостов с плавающей точкой: 476 − 76 не должно давать 399.99. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Число для файла с разделителем «;» — С ЗАПЯТОЙ.
 *
 * Точка в таком файле открывается в русской и кипрской локали Excel как
 * ТЕКСТ: колонка «Сумма» не суммируется, и бухгалтер переколачивает её
 * руками. Минус — обычный дефис, а не типографский U+2212 форматтера:
 * знак Excel понимает только в ASCII.
 *
 * Кавычек не ставим и через `csvCell` НЕ пропускаем: запятая внутри числа
 * заставила бы его закавычить, а закавыченную ячейку Excel снова читает как
 * текст. Разделитель «;», поэтому запятая ячейку не разрывает.
 */
function csvMoney(value: number): string {
  const cents = Math.round(value * 100);
  const abs = Math.abs(cents);
  const body = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${body}` : body;
}

/** Заголовки колонок операции — общие у обеих выгрузок, кроме второй. */
const TX_COLUMNS = [
  "Дата",
  "Тип",
  "Категория",
  "Команда",
] as const;

const TAIL_COLUMNS = [
  "Способ оплаты",
  "Сумма",
  "НДС",
  "Без НДС",
  "Ставка",
  "Режим НДС",
  "Документ",
  "Заметка",
  "ID операции",
] as const;

/**
 * Хвост строки операции — от способа оплаты до id.
 *
 * СУММА ПЕЧАТАЕТСЯ СО ЗНАКОМ. Раньше в колонке лежал сырой `amount`: расход
 * шёл положительным, возврат отрицательным, и одна колонка несла две разные
 * договорённости. Сумма столбца в такой выгрузке не значила ничего.
 */
function txTail(tx: FinanceTransaction): string[] {
  const amount = signedAmount(tx);
  // НАЛОГ ОТДЕЛЬНОЙ КОЛОНКОЙ. Бухгалтеру нужна не валовая сумма, а разбор:
  // сколько из неё налог и сколько осталось компании. Знак налога следует за
  // знаком строки — иначе возврат вернул бы налог со знаком плюс.
  const vat =
    amount < 0
      ? -Math.abs(tx.vat_amount ?? 0)
      : Math.abs(tx.vat_amount ?? 0);
  return [
    csvTextCell(tx.payment_method ? PAYMENT_METHOD_LABEL[tx.payment_method] : ""),
    csvMoney(amount),
    csvMoney(vat),
    csvMoney(round2(amount - vat)),
    csvTextCell(tx.vat_rate != null ? String(tx.vat_rate) : ""),
    // Строка без vat_mode — легаси до трёх клавиш НДС: как назначали налог,
    // не записано. Печатаем «—», а не догадку: колонка обещает бухгалтеру
    // факт, и «НДС включён» наугад в тенанте с настройкой «Плюс НДС» — ложь.
    // Ставка и сумма налога при этом остаются — они записаны честно.
    csvTextCell(
      tx.vat_mode
        ? VAT_MODE_LABEL[tx.vat_mode] ?? ""
        : tx.vat_amount != null
          ? "—"
          : "",
    ),
    // Подтверждающий документ: «есть/нет» — по нему бухгалтер сразу видит,
    // какие расходы нельзя принять к зачёту, и что просить у команды.
    csvTextCell(tx.receipt_url ? "есть" : ""),
    csvTextCell(tx.notes ?? ""),
    // id операции — чтобы строку из файла можно было найти в продукте, когда
    // бухгалтер спрашивает «а что это за €120».
    csvTextCell(tx.id),
  ];
}

function head(
  tx: FinanceTransaction,
  categoryName: ReadonlyMap<string, string>,
  teamName: ReadonlyMap<string, string> | undefined,
): string[] {
  return [
    csvCell(tx.occurred_on),
    csvCell(TX_TYPE_LABEL[tx.type]),
    csvTextCell(tx.category_id ? categoryName.get(tx.category_id) ?? "" : ""),
    // Общекорпоративная операция без команды — честная строка «Компания».
    csvTextCell(tx.team_id ? teamName?.get(tx.team_id) ?? "" : "Компания"),
  ];
}

// СВОДНОЙ ВЫГРУЗКИ ПО ВСЕМ ОПЕРАЦИЯМ ЗДЕСЬ НЕТ. Владелец 2026-08-11 убрал
// «Отчёт бухгалтеру» из продукта: файл без остатка на начало и на конец не
// сводится ни с банком, ни с кассой — по нему нельзя проверить, что ничего не
// потерялось. Остаётся выписка ПО СЧЁТУ ниже: у неё эти границы есть.

export interface AccountStatementInput {
  account: Pick<Account, "id" | "name">;
  /** ПОЛНЫЙ срез операций периода (все счета): вторую ногу перевода иначе не
   *  найти, а без неё колонка «Корреспондент» пуста ровно там, где нужна. */
  ledger: readonly FinanceTransaction[];
  categories: readonly FinanceCategory[];
  /** Серверные итоги ЭТОГО счёта за период: остаток на начало и движения. */
  totals: AccountPeriodSummary;
  period: { from: string; to: string };
  lookups?: CsvLookups;
}

/**
 * ВЫПИСКА ПО ОДНОМУ СЧЁТУ за период — единственный формат, который бухгалтер
 * может свести с банком.
 *
 * Три отличия от общего отчёта:
 *   • первой строкой «Остаток на начало», последней «Остаток на конец» —
 *     без них файл не сходится ни с чем;
 *   • переводы ВНУТРИ (это движение денег по счёту, даже если не доход);
 *   • колонка «Счёт» заменена на «Корреспондент»: счёт здесь один и назван в
 *     имени файла, а вторая сторона перевода — то, ради чего строку читают.
 *
 * Остаток на конец берётся из тех же серверных колонок, что и колонка «ЗА
 * ПЕРИОД» на экране (сложением, без единого минуса), а не пересчётом ленты:
 * два способа посчитать одно число всегда однажды разойдутся.
 */
export function accountStatementToCsv({
  account,
  ledger,
  categories,
  totals,
  period,
  lookups = {},
}: AccountStatementInput): { contents: string; count: number } {
  const categoryName = new Map(categories.map((item) => [item.id, item.name]));
  const accountName = new Map(
    (lookups.accounts ?? []).map((item) => [item.id, item.name]),
  );
  const own = ledger.filter((tx) => tx.account_id === account.id);
  // Вторая нога перевода: та же группа, другой счёт. Пара по инварианту БД
  // ровно из двух строк, поэтому первого совпадения достаточно.
  const correspondent = (tx: FinanceTransaction): string => {
    if (tx.type !== "transfer" || !tx.transfer_group_id) return "";
    const other = ledger.find(
      (x) =>
        x.transfer_group_id === tx.transfer_group_id && x.account_id !== tx.account_id,
    );
    if (!other?.account_id) return "";
    return accountName.get(other.account_id) ?? "";
  };

  const boundary = (date: string, label: string, value: number): string[] => [
    csvCell(date),
    csvCell(label),
    "",
    "",
    "",
    "",
    csvMoney(value),
    ...Array<string>(TAIL_COLUMNS.length - 2).fill(""),
  ];

  const rows = [...own]
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))
    .map((tx) => [
      ...head(tx, categoryName, lookups.teamName),
      csvTextCell(correspondent(tx)),
      ...txTail(tx),
    ]);

  return {
    contents: csvDocument([
      [...TX_COLUMNS, "Корреспондент", ...TAIL_COLUMNS].map(csvCell),
      boundary(period.from, "Остаток на начало", totals.opening_before),
      ...rows,
      boundary(period.to, "Остаток на конец", accountPeriodClosing(totals)),
    ]),
    count: own.length,
  };
}
