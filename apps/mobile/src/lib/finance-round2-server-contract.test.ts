import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ФИНАНСЫ, ВТОРОЙ КРУГ АУДИТА: миграция закрывает скрытые счета в документах,
// окно партнёра в сводках счетов, налог последней доли и повторы кредит-нот.
// Ни типам, ни экранам эти дыры не видны — тест держит текст миграции и то,
// что после неё эти функции никто не переопределил «из старой копии».

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../supabase/migrations");
const FILE = "20261016170100_finance_hidden_accounts_window_vat.sql";
const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8");

function body(name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  assert.ok(start >= 0, `в миграции нет функции ${name}`);
  const open = sql.indexOf("$function$", start);
  return sql.slice(open, sql.indexOf("$function$", open + 10));
}

function lastDefiner(name: string): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      new RegExp(`create (or replace )?function public\\.${name}\\(`, "i").test(
        readFileSync(path.join(MIGRATIONS, f), "utf8"),
      ),
    );
  return defining[defining.length - 1];
}

test("функции миграции не переопределены позже", () => {
  for (const fn of [
    "_assert_account_not_hidden",
    "_receipt_tx_allowed",
    "issue_receipt",
    "_refund_invoice_money",
    "refund_receipt",
    "issue_partial_credit_note",
    "issue_invoice",
    "fill_transaction_vat",
    "_issue_credit_note",
    "_issue_receipt_credit_note",
    "account_period_totals",
    "account_balances",
  ]) {
    assert.equal(lastDefiner(fn), FILE, `${fn} переопределён позже`);
  }
});

test("скрытый счёт: чек, возврат по чеку и возврат по ноте — только владельцу", () => {
  const helper = body("_assert_account_not_hidden");
  assert.match(helper, /current_user_role\(\) is distinct from 'owner'/);
  assert.match(helper, /a\.is_hidden/);
  assert.match(helper, /hint = 'block:finance\.documents'/);
  assert.match(body("issue_receipt"), /_assert_account_not_hidden\(tenant_uuid, tx\.account_id\)/);
  assert.match(body("refund_receipt"), /_assert_account_not_hidden\(tenant_uuid, income_row\.account_id\)/);
  assert.match(
    body("_refund_invoice_money"),
    /_assert_account_not_hidden\(p_invoice\.tenant_id, income_row\.account_id\)/,
  );
  const allowed = body("_receipt_tx_allowed");
  assert.match(allowed, /hidden_account\.is_hidden/);
  assert.match(allowed, /current_user_role\(\) is distinct from 'owner'/);
});

test("строки чеков на скрытом счёте не-владельцу не видны", () => {
  assert.match(
    sql,
    /create policy receipts_hidden_owner_only on public\.receipts\s+as restrictive\s+for select/,
  );
  assert.match(sql, /not \(account_id in \(select unnest\(public\.hidden_account_ids\(\)\)\)\)/);
});

test("сводки счетов знают окно партнёра и права «Доход» / «Расход»", () => {
  for (const fn of ["account_period_totals", "account_balances"]) {
    const text = body(fn);
    assert.match(text, /member_finance_window_starts\(\)/, fn);
    assert.match(text, /access_calendars\('finance\.income', 'read'\)/, fn);
    assert.match(text, /access_calendars\('finance\.expense', 'read'\)/, fn);
    assert.match(text, /access_calendars\('finance\.debts', 'read'\)/, fn);
    assert.match(text, /'-infinity'::date/, fn);
    // Оплаты долгов и переводы окна не знают — как в политике окна.
    assert.match(text, /t\.type = 'transfer'/, fn);
    assert.match(text, /t\.debt_id is not null/, fn);
  }
  // Остаток считается по всем строкам: даты и периодные суммы идут по видимым.
  const balances = body("account_balances");
  assert.match(balances, /\) as ledger_delta,/);
  assert.match(balances, /max\(tx\.occurred_on\) filter \(where tx\.visible\) as ledger_last_tx_on/);
  assert.match(balances, /min\(tx\.occurred_on\) filter \(where tx\.visible\) as ledger_first_tx_on/);
  assert.match(balances, /count\(\*\) as tx_count/);
  const totals = body("account_period_totals");
  assert.match(totals, /\) filter \(where tx\.occurred_on < p_from\) as delta_before/);
  assert.match(totals, /where tx\.visible and tx\.type = 'income' and tx\.occurred_on >= p_from/);
  assert.match(totals, /where tx\.visible and tx\.type = 'expense' and tx\.occurred_on >= p_from/);
  assert.match(totals, /where tx\.visible and tx\.type = 'refund' and tx\.occurred_on >= p_from/);
});

test("привязанный к инвойсу доход берёт налог бумаги в том же обновлении", () => {
  const issue = body("issue_invoice");
  assert.match(issue, /vat_mode = case when vat_total > 0 then 'inclusive' else 'none' end/);
  assert.match(issue, /vat_rate = case when vat_total > 0 then vat_rate_percent else null end/);
  assert.match(issue, /vat_amount = case when vat_total > 0 then vat_total else null end/);
  // Переменная ставки названа иначе, чем колонка: в UPDATE имя `vat_rate` — колонка.
  assert.match(issue, /vat_rate_percent := vat_rate;/);
});

test("последняя доля возврата и кредит-ноты берёт остаток налога", () => {
  const fill = body("fill_transaction_vat");
  assert.match(fill, /refunded_before \+ abs\(new\.amount\) >= original\.amount/);
  assert.match(fill, /vat_left := greatest\(0, original\.vat_amount - vat_before\)/);
  assert.match(fill, /r\.id is distinct from new\.id/);
  assert.match(fill, /new\.vat_amount := sign\(new\.amount\) \* vat_share/);

  const note = body("_issue_credit_note");
  assert.match(note, /coalesce\(original\.vat_amount, 0\) - coalesce\(\(/);
  assert.match(note, /prior\.credit_note_of_id = original\.id/);
  assert.match(note, /-note_vat,/);
  assert.doesNotMatch(note, /original\.vat_amount \* \(original\.total - original\.credited_amount\)/);

  const receiptNote = body("_issue_receipt_credit_note");
  assert.match(receiptNote, /credited_before \+ amount_value >= receipt_row\.amount then vat_left/);
  assert.match(receiptNote, /prior\.credit_note_of_receipt_id = receipt_row\.id/);

  // Доля частичной ноты не больше остатка налога бумаги.
  const partial = body("issue_partial_credit_note");
  assert.match(partial, /least\(\s*round\(invoice_row\.vat_amount \* amount_value \/ invoice_row\.total, 2\),/);
});

test("чек на оплату долга не выписывается", () => {
  const issue = body("issue_receipt");
  assert.match(issue, /if tx\.debt_id is not null then\s+raise exception 'По оплате долга чек не выписывается'/);
  assert.match(issue, /hint = 'receipt:debt_payment'/);
  // Уже выданный чек возвращается раньше отказа: старые строки не ломаются.
  assert.ok(
    issue.indexOf("select * into existing") < issue.indexOf("tx.debt_id is not null"),
    "отказ по долгу стоит раньше возврата существующего чека",
  );
});

test("повтор запроса кредит-ноты: своя нота; полная отмена идемпотентна", () => {
  const partial = body("issue_partial_credit_note");
  assert.match(
    partial,
    /if note_row\.kind = 'credit_note' and note_row\.credit_note_of_id = invoice_row\.id then\s+return note_row;\s+end if;\s+raise exception 'Запрос кредит-ноты уже использован';/,
  );
  assert.match(partial, /if invoice_row\.status = 'cancelled' then/);
  assert.match(partial, /not note\.credit_partial/);
  assert.match(partial, /note\.created_by is not distinct from auth\.uid\(\)/);
  assert.match(partial, /-note\.total = round\(p_amount, 2\)/);
  // Повтор полной отмены ищется раньше проверки статуса, иначе она его не дождётся.
  assert.ok(
    partial.indexOf("if invoice_row.status = 'cancelled' then") <
      partial.indexOf("if invoice_row.status not in ('issued', 'paid') then"),
    "поиск ноты полной отмены стоит после проверки статуса",
  );
});

test("внутренние помощники закрыты для authenticated", () => {
  for (const sig of [
    "_assert_account_not_hidden\\(uuid, uuid\\)",
    "_receipt_tx_allowed\\(public\\.finance_transactions\\)",
    "_refund_invoice_money\\(public\\.invoices, numeric, date, text, uuid\\)",
    "_issue_credit_note\\(uuid, text\\)",
    "_issue_receipt_credit_note\\(uuid, numeric, text, text\\)",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`),
      sig,
    );
  }
  for (const sig of [
    "account_balances\\(uuid\\)",
    "account_period_totals\\(uuid, date, date\\)",
    "refund_receipt\\(uuid, uuid, numeric, text, text\\)",
    "issue_partial_credit_note\\(uuid, uuid, numeric, text, text, uuid\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${sig} from public, anon;`), sig);
  }
});

test("миграция сама проверяет, что правки встали", () => {
  assert.match(sql, /проверка скрытого счёта не встала/);
  assert.match(sql, /окно партнёра не встало/);
  assert.match(sql, /налог долей не встал/);
  assert.match(sql, /политика чеков не встала/);
});
