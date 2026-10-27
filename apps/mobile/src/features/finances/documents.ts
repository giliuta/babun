import {
  calculateInvoiceSettlement,
  invoiceInTeamScope,
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
 * Сегмент над списком — ровно вид документа, третьего значения нет (только два подраздела
 * — инвойсы и чеки). Общий сегмент
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
   *  цветом (неоплаченный документ — не тревога). */
  state: string | null;
  /** Документ аннулирован или отменён. Из списка он не пропадает: номер занят,
   *  и проверяющий обязан видеть, почему. Строка гаснет, а не исчезает. */
  dead: boolean;
  /** Кредит-нота: в списке видна, в числе документов плитки не считается. */
  creditNote?: boolean;
  /** Команда документа (инвойс — `brigade_id`, чек — команда того, за что
   *  выдан). По ней партнёр с «Документы: Видит» читает документ.
   *  `null` — общий, без команды. */
  teamId: string | null;
  /** Предсобранная строка поиска: номер, клиент, сумма. Собирается один раз на
   *  документ, а не на каждую нажатую букву. */
  search: string;
}

export interface DocumentSources {
  invoices: readonly InvoiceLedger[];
  /** Проводки по инвойсам, ключ — invoice_id (`useInvoicePayments`). */
  payments: Readonly<Record<string, InvoicePaymentLedger[]>>;
  /** Деньги записей, принятые мимо их инвойсов (`listInvoiceAppointmentMoney`). */
  appointmentMoney?: Readonly<Record<string, number>>;
  receipts: readonly Receipt[];
  /** Живое имя клиента — фолбэк, когда в документе нет снимка. */
  clientName: (clientId: string | null) => string | null;
  /**
   * Чья команда выдала чек: `receipts.team_id` (NOT NULL в базе), а у чека
   * из кэша старой сборки без колонки — команда того, за что он выдан
   * (инвойс → запись → счёт). `null` — ничей: такой документ показываем в
   * ЛЮБОМ срезе, потому что потерять бумагу хуже, чем показать лишнюю.
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
  // Номера кредит-нот ищутся по их инвойсу: своей строки у ноты нет. ВСЕ
  // номера, а не последний записанный: у инвойса с двумя частичными нотами
  // поиск «CN-…-0002» не находил ничего.
  const noteNumbersOf = new Map<string, string[]>();
  // Инвойсы, отменённые ЦЕЛИКОМ: возвращено всё, и каждый их чек тоже.
  const fullyCredited = new Set<string>();
  // Проводки, с которых деньги вернули (`refund_of_id` возврата).
  const refundedPayments = new Set<string>();
  for (const rows of Object.values(sources.payments)) {
    for (const row of rows) {
      if (row.type === "refund" && row.refund_of_id) refundedPayments.add(row.refund_of_id);
    }
  }
  // Чеки с нотой к самому чеку.
  const receiptNotes = new Map<string, string>();
  for (const invoice of sources.invoices) {
    if (invoice.kind === "credit_note" && invoice.credit_note_of_id) {
      const numbers = noteNumbersOf.get(invoice.credit_note_of_id) ?? [];
      numbers.push(invoice.number);
      noteNumbersOf.set(invoice.credit_note_of_id, numbers);
      if (!invoice.credit_partial) fullyCredited.add(invoice.credit_note_of_id);
    }
    if (invoice.kind === "credit_note" && invoice.credit_note_of_receipt_id) {
      receiptNotes.set(invoice.credit_note_of_receipt_id, invoice.number);
    }
  }

  for (const invoice of sources.invoices) {
    if (!inPeriod(invoice.issued_on, sources.period)) continue;
    // Инвойс знает свою команду сам. Документ без команды — общий, и его
    // видно в любом срезе (то же правило, что у чека без хозяина).
    if (!invoiceInTeamScope(invoice, sources.teamId)) continue;
    const settlement = calculateInvoiceSettlement(
      invoice,
      sources.payments[invoice.id] ?? [],
      sources.appointmentMoney?.[invoice.id] ?? 0,
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
    // КРЕДИТ-НОТА — ЧАСТЬ СВОЕГО ИНВОЙСА, А НЕ ОТДЕЛЬНАЯ СТРОКА: это по сути один
    // файл, инвойс становится серым, как отменённый. Нота живёт на странице
    // инвойса; в списке — только он, погасший, и её номер находит его поиском.
    if (invoice.kind === "credit_note") continue;
    const noteNumbers = noteNumbersOf.get(invoice.id) ?? [];
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
          // Частично оплаченный — тем же словом, что на странице инвойса
          // (`invoiceDisplayStatus`: частичная оплата важнее просрочки), а
          // не «К оплате», как нетронутый.
          : settlement.isPartial
            ? "Частично оплачен"
            : overdue
              ? "Просрочен"
              : "К оплате",
      dead,
      teamId: invoice.brigade_id ?? null,
      search: searchKey(
        [invoice.number, ...noteNumbers].join(" "),
        clientName,
        invoice.total,
      ),
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
      // ВОЗВРАТ — СЛОВОМ: погашенный возвратом — «Возвращён», частично —
      // «Частично возвращён»; номер ноты находит чек поиском.
      state: (() => {
        // ВОЗВРАЩЁН ИМЕННО ЭТОТ ЧЕК: нота к нему самому, отмена всего
        // инвойса или возврат с его платежа. Любая частичная нота инвойса
        // («Вернуть» с другого платежа, снятие неоплаченной части) метила
        // «Частично возвращён» каждый его чек.
        const returned =
          receiptNotes.has(receipt.id)
          || (!!receipt.invoice_id && fullyCredited.has(receipt.invoice_id))
          || (!!receipt.transaction_id && refundedPayments.has(receipt.transaction_id));
        if (receipt.status === "void") return returned ? "Возвращён" : "Аннулирован";
        return returned ? "Частично возвращён" : null;
      })(),
      dead: receipt.status === "void",
      teamId: team,
      search: searchKey(
        [receipt.number, receiptNotes.get(receipt.id)].filter(Boolean).join(" "),
        clientName,
        receipt.amount,
      ),
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
