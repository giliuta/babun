import {
  paymentMethodLabel,
  signedAmount,
  TX_TYPE_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { formatSignedMoneyExact, money } from "@babun/shared/common/utils/money";
import { payeeName, withPayee } from "../category-asks";

// ВЫПИСКА СЧЁТА — ОДИН ДОКУМЕНТ, ДВА РЕНДЕРА (владелец 03.10: «когда выписка
// делается, то сначала создаётся превью файла, а потом уже можно только
// передавать это»). Тот же приём, что у чека и инвойса: модель здесь, бумага
// на экране — `StatementPaper.tsx`, печать в PDF — `statement-pdf.ts`; порядок
// полей у обоих стережёт `statement-paper-contract.test.ts`. Что увидел на
// экране — то и ушло файлом.
//
// Остаток идёт тем же счётом, что у сервера (`account_balances`): остаток на
// начало плюс операции счёта со знаком (`signedAmount`). Строки — от старых к
// новым, как в банковской выписке: остаток в каждой строке читается вниз.

export interface StatementRow {
  /** Кто или что: клиент, категория, другой счёт перевода. */
  title: string;
  /** Вид операции и способ: «Доход · Наличные». */
  detail: string;
  /** Со знаком: «+€120», «−€35». */
  amount: string;
  /** Остаток счёта после этой строки. */
  balance: string;
}

export interface StatementDay {
  /** «12.09.2026». */
  date: string;
  rows: StatementRow[];
}

export interface StatementDocument {
  accountName: string;
  teamName: string | null;
  period: string;
  opening: string;
  days: StatementDay[];
  income: string;
  expense: string;
  closing: string;
}

export interface StatementRefs {
  accounts: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  clients: readonly { id: string; full_name: string }[];
  people?: readonly { id: string; full_name: string }[];
}

export interface StatementInput {
  account: { id: string; name: string; opening_balance: number };
  teamName: string | null;
  /** Все операции, какие видны: нужны и чужие ноги переводов — по ним
   *  называется другой счёт. Свои строки модель выберет сама. */
  transactions: readonly FinanceTransaction[];
  refs: StatementRefs;
  /** Сегодня по поясу команды — конец «всего времени». */
  today: string;
  /** ПЕРИОД ВЫПИСКИ (владелец 03.10: «выписка за период — прям хорошо»).
   *  Нет — всё время: от первой операции до сегодня. Остаток на начало —
   *  остаток счёта к началу периода (остаток на начало счёта + всё, что
   *  прошло до `from`). */
  period?: { from: string; to: string } | null;
}

export function buildStatementDocument(input: StatementInput): StatementDocument {
  // Валюта — компании (`money`), как у «На счёте» в листе счёта.
  const fmt = (value: number) => money(value);
  const signed = (value: number) => formatSignedMoneyExact(value);

  const own = input.transactions
    .filter((tx) => tx.account_id === input.account.id)
    .sort(
      (a, b) =>
        a.occurred_on.localeCompare(b.occurred_on)
        || (a.occurred_time ?? "").localeCompare(b.occurred_time ?? "")
        || a.created_at.localeCompare(b.created_at),
    );

  const range = input.period ?? null;
  // Считаем в центах: сорок строк по 0,10 не обязаны дать 4,0000000001.
  let running = Math.round(input.account.opening_balance * 100);
  // Всё, что прошло ДО периода, — в остаток на его начало.
  for (const tx of own) {
    if (range && tx.occurred_on < range.from) running += Math.round(signedAmount(tx) * 100);
  }
  const openingCents = running;
  const inPeriod = range
    ? own.filter((tx) => tx.occurred_on >= range.from && tx.occurred_on <= range.to)
    : own;
  let incomeCents = 0;
  let expenseCents = 0;
  const days: StatementDay[] = [];
  for (const tx of inPeriod) {
    const cents = Math.round(signedAmount(tx) * 100);
    running += cents;
    if (cents > 0) incomeCents += cents;
    else expenseCents -= cents;
    const date = formatStatementDate(tx.occurred_on);
    let day = days[days.length - 1];
    if (!day || day.date !== date) {
      day = { date, rows: [] };
      days.push(day);
    }
    const title = rowTitle(tx, input.transactions, input.refs);
    day.rows.push({
      title,
      detail: rowDetail(tx, title),
      amount: signed(cents / 100),
      balance: fmt(running / 100),
    });
  }

  const from = range?.from ?? own[0]?.occurred_on ?? input.today;
  const to = range?.to ?? input.today;
  return {
    accountName: input.account.name,
    teamName: input.teamName,
    period: `${formatStatementDate(from)} — ${formatStatementDate(to)}`,
    opening: fmt(openingCents / 100),
    days,
    income: signed(incomeCents / 100),
    expense: signed(-expenseCents / 100),
    closing: fmt(running / 100),
  };
}

/** Кто или что стоит за деньгами. У перевода — другой счёт пары. */
function rowTitle(
  tx: FinanceTransaction,
  all: readonly FinanceTransaction[],
  refs: StatementRefs,
): string {
  const label = typeLabel(tx);
  if (tx.type === "transfer") {
    const other = tx.transfer_group_id
      ? all.find((leg) => leg.transfer_group_id === tx.transfer_group_id && leg.id !== tx.id)
      : undefined;
    const name = other?.account_id
      ? refs.accounts.find((a) => a.id === other.account_id)?.name
      : undefined;
    if (!name) return label;
    return tx.amount < 0 ? `На ${name}` : `С ${name}`;
  }
  const client = tx.client_id ? refs.clients.find((c) => c.id === tx.client_id)?.full_name : undefined;
  const category = tx.category_id ? refs.categories.find((c) => c.id === tx.category_id)?.name : undefined;
  if (tx.type === "expense") {
    if (category) return withPayee(category, payeeName(refs.people, tx.master_id));
    return clean(tx.notes) || label;
  }
  return client || category || clean(tx.notes) || label;
}

/** «Доход · Наличные». Если заголовок уже назвал вид — только способ. */
function rowDetail(tx: FinanceTransaction, title: string): string {
  const label = typeLabel(tx);
  const method = tx.type === "transfer" ? "" : paymentMethodLabel(tx.payment_method);
  return [title === label ? "" : label, method].filter(Boolean).join(" · ");
}

/** Вид операции словом. Минус по записи — двумя словами, как в истории
 *  оплат записи (`payment-history.ts`): деньги вернули клиенту или оплату
 *  сняли, потому что она не пришла. */
function typeLabel(tx: FinanceTransaction): string {
  if (tx.type === "refund" && tx.reversal_kind === "not_received") return "Оплата снята";
  return TX_TYPE_LABEL[tx.type] ?? tx.type;
}

/** «12.09.2026» — дата цифрами, как у чека. */
export function formatStatementDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
