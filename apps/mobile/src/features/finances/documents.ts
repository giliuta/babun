import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { receiptClientName, type Receipt } from "@babun/shared/local/finance/receipt";

// ОДНА ЛЕНТА БУМАГ КОМПАНИИ.
//
// Инвойс и чек лежат в разных таблицах и заведены разными событиями (счёт
// выставляют руками, чек выписывает сервер в момент приёма денег), но человек
// спрашивает одно: «какие документы у нас за этот период». Поэтому строка
// списка — общая, а различия сведены к типу, состоянию и тому, куда строка
// открывается.
//
// Здесь только правило (что попадает в срез, как называется, чем сортируется);
// вёрстка живёт в `DocumentsPanel`, и оба покрыты тестом на этот файл.

export type DocumentKind = "invoice" | "receipt";

/**
 * Сегмент над списком — ровно вид документа, третьего значения нет (владелец
 * 2026-08-12: «есть только два подраздела — инвойсы и чеки»). Общий сегмент
 * «Все» смешивал в одну ленту счёт на оплату и подтверждение приёма денег:
 * бумаги разной природы, и главное действие внизу экрана у них тоже разное.
 */
export type DocumentFilter = DocumentKind;

export interface FinanceDocument {
  id: string;
  kind: DocumentKind;
  /** «Инвойс INV-2026-001» — тип и номер одной строкой, как их называют вслух. */
  title: string;
  clientName: string;
  /** YYYY-MM-DD, дата выдачи: по ней срез периода и порядок списка. */
  date: string;
  amount: number;
  currency: string;
  /** «Оплачен» / «К оплате» / «Просрочен» / «Аннулирован». null — состояния
   *  нет вовсе: выданный чек ничего не ждёт. Состояние говорит СЛОВОМ, а не
   *  цветом (владелец 2026-08-15: неоплаченный документ — не тревога). */
  state: string | null;
  /** Документ аннулирован или отменён. Из списка он не пропадает: номер занят,
   *  и проверяющий обязан видеть, почему. Строка гаснет, а не исчезает. */
  dead: boolean;
  /** Предсобранная строка поиска: номер, клиент, сумма. Собирается один раз на
   *  документ, а не на каждую нажатую букву. */
  search: string;
}

export interface DocumentSources {
  invoices: readonly InvoiceLedger[];
  /** Проводки по инвойсам, ключ — invoice_id (`useInvoicePayments`). */
  payments: Readonly<Record<string, InvoicePaymentLedger[]>>;
  receipts: readonly Receipt[];
  /** Живое имя клиента — фолбэк, когда в документе нет снимка. */
  clientName: (clientId: string | null) => string | null;
  /**
   * Чья команда выдала чек. В самой таблице `receipts` команды нет вовсе,
   * поэтому её спрашивают у того, за что чек выдан (инвойс → запись → счёт).
   * `null` — ничей: такой документ показываем в ЛЮБОМ срезе, потому что
   * потерять бумагу хуже, чем показать лишнюю.
   */
  receiptTeamId: (receipt: Receipt) => string | null;
  period: { from: string; to: string };
  /** Срез команды. `null` — не фильтруем (на экране он всегда есть). */
  teamId: string | null;
  /** Сегодня по времени бизнеса — граница просрочки. */
  today: string;
}

/** Документы среза, новые сверху. Одна дата — выше тот, чей номер больше:
 *  порядок обязан быть детерминированным, иначе список переставляется сам
 *  при каждом рефетче. */
export function collectDocuments(sources: DocumentSources): FinanceDocument[] {
  const docs: FinanceDocument[] = [];

  for (const invoice of sources.invoices) {
    if (!inPeriod(invoice.issued_on, sources.period)) continue;
    // Инвойс знает свою команду сам. Документ без команды — общий, и его
    // видно в любом срезе (то же правило, что у чека без хозяина).
    if (
      sources.teamId &&
      invoice.brigade_id &&
      invoice.brigade_id !== sources.teamId
    ) {
      continue;
    }
    const settlement = calculateInvoiceSettlement(
      invoice,
      sources.payments[invoice.id] ?? [],
    );
    const overdue =
      !settlement.isPaid &&
      invoice.status !== "void" &&
      invoice.status !== "cancelled" &&
      !!invoice.due_on &&
      invoice.due_on < sources.today;
    const dead = invoice.status === "void" || invoice.status === "cancelled";
    const clientName =
      invoice.client_snapshot?.full_name?.trim() ||
      sources.clientName(invoice.client_id) ||
      "Без клиента";
    docs.push({
      id: invoice.id,
      kind: "invoice",
      title: `Инвойс ${invoice.number}`,
      clientName,
      date: invoice.issued_on,
      amount: invoice.total,
      currency: invoice.currency,
      state: dead
        ? invoice.status === "void"
          ? "Аннулирован"
          : "Отменён"
        : settlement.isPaid
          ? "Оплачен"
          : overdue
            ? "Просрочен"
            : "К оплате",
      dead,
      search: searchKey(invoice.number, clientName, invoice.total),
    });
  }

  for (const receipt of sources.receipts) {
    if (!inPeriod(receipt.issued_on, sources.period)) continue;
    const team = sources.receiptTeamId(receipt);
    if (sources.teamId && team && team !== sources.teamId) continue;
    const clientName = receiptClientName(receipt);
    docs.push({
      id: receipt.id,
      kind: "receipt",
      title: `Чек ${receipt.number}`,
      clientName,
      date: receipt.issued_on,
      amount: receipt.amount,
      currency: receipt.currency,
      // Выданный чек не ждёт ничего: деньги уже получены. Состояние есть
      // только у аннулированного — иначе непонятно, почему строка потухла.
      // Слово то же, что у инвойса: «погашен» в финансах значит «оплачен»,
      // и потухший чек сообщал бы противоположное случившемуся.
      state: receipt.status === "void" ? "Аннулирован" : null,
      dead: receipt.status === "void",
      search: searchKey(receipt.number, clientName, receipt.amount),
    });
  }

  return docs.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      // Номер сравнивается ЧИСЛОМ (`numeric`): строковое сравнение ставило
      // «…-9» выше «…-10», и порядок дня переставал совпадать с выдачей.
      b.title.localeCompare(a.title, "ru", { numeric: true }),
  );
}

/** Сегмент и поиск — по уже собранному списку: оба фильтра дешёвые, а второй
 *  прогон источников на каждую букву дал бы разные строки под одним запросом. */
export function filterDocuments(
  docs: readonly FinanceDocument[],
  filter: DocumentFilter,
  query: string,
): FinanceDocument[] {
  // Разрядные пробелы выкидываются только МЕЖДУ цифрами: набранное «1 200» и
  // скопированное «1 200» (там неразрывный пробел, `\s` ловит и его) находят
  // сумму, а имя из двух слов ищется как раньше.
  const needle = query
    .trim()
    .toLowerCase()
    .replace(/(\d)\s+(?=\d)/g, "$1");
  return docs.filter(
    (doc) => doc.kind === filter && (!needle || doc.search.includes(needle)),
  );
}

function inPeriod(date: string, period: { from: string; to: string }): boolean {
  return date >= period.from && date <= period.to;
}

/** Сумма лежит в поиске в обеих письменных формах: как хранится («480.5») и
 *  как напечатана на строке («480,50») — человек набирает ту, что видит. */
function searchKey(number: string, clientName: string, amount: number): string {
  const printed = amount.toFixed(2);
  const forms = `${amount} ${printed} ${printed.replace(".", ",")}`;
  return `${number} ${clientName} ${forms}`.toLowerCase();
}
