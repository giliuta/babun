import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ДОКУМЕНТЫ И ПРАВА ФИНАНСОВ: миграция закрывает дыры, которые не видны
// ни типам, ни экранам, — любую из них вернёт «безобидная» перезапись
// функции из старой копии. Тест держит текст миграции и то, что после неё
// эти функции никто не переопределил.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../supabase/migrations");
const FILE = "20261016150000_finance_documents_hardening.sql";
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
    "build_invoice_client_snapshot",
    "update_invoice_draft",
    "update_receipt",
    "record_invoice_payment",
    "validate_invoice_payment_insert",
    "delete_credit_note",
    "enforce_plan_limits",
    "void_receipt_on_income_delete",
    "void_receipt_on_refund",
  ]) {
    assert.equal(lastDefiner(fn), FILE, `${fn} переопределён позже`);
  }
});

test("скрытые счета и VAT (20261016180100) — единственное позднейшее переопределение", () => {
  // Четыре функции поправлены ещё раз: скрытые счета, окончательная доля VAT,
  // повтор кредит-ноты. Позже — никто.
  for (const fn of ["issue_invoice", "issue_receipt", "issue_partial_credit_note", "_refund_invoice_money"]) {
    assert.equal(lastDefiner(fn), "20261016180100_finance_hidden_accounts_window_vat.sql", `${fn} переопределён позже`);
  }
});

test("снимки документов не несут номеров клиента", () => {
  const builder = body("build_invoice_client_snapshot");
  assert.doesNotMatch(builder, /phone|whatsapp/);
  assert.match(sql, /client_snapshot - 'phone' - 'phone_e164' - 'whatsapp_phone'/);
  for (const table of ["invoices", "receipts"]) {
    assert.match(
      sql,
      new RegExp(`create trigger trg_strip_snapshot_contacts\\s+before insert or update on public\\.${table}`),
    );
    assert.match(sql, new RegExp(`alter table public\\.${table} disable trigger user;[\\s\\S]*?alter table public\\.${table} enable trigger user;`));
  }
});

test("бумага не печатает номер из снимка", () => {
  const parties = readFileSync(path.join(here, "paper/document/parties.ts"), "utf8");
  assert.doesNotMatch(parties, /\.phone|phone_e164|whatsapp/);
});

test("правка черновика проверяет то же, что выпуск", () => {
  const draft = body("update_invoice_draft");
  assert.match(draft, /access_client_ids_in/);
  assert.match(draft, /resolved_brigade_id = any\(public\.access_calendars\('finance\.documents', 'write'\)\)/);
  assert.match(draft, /entity\.vat_number/);
  assert.match(draft, /_assert_invoice_wait_account/);
  assert.match(draft, /credited_amount > 0/);
  assert.match(draft, /tenant_business_date/);
  const wait = body("_assert_invoice_wait_account");
  assert.match(wait, /account_serves_team/);
  assert.match(wait, /is_hidden/);
});

test("налог последней доли считается от суммы за вычетом сторно", () => {
  const pay = body("record_invoice_payment");
  assert.match(pay, /invoice_row\.total - invoice_row\.credited_amount\) \/ invoice_row\.total/);
  assert.match(pay, /not is_hidden or public\.current_user_role\(\) is not distinct from 'owner'/);
  assert.match(body("validate_invoice_payment_insert"), /not is_hidden/);
  assert.match(body("issue_invoice"), /not acc\.is_hidden/);
});

test("документ не выписывается будущей датой", () => {
  for (const fn of ["issue_invoice", "issue_receipt", "update_receipt", "update_invoice_draft"]) {
    assert.match(body(fn), /> public\.tenant_business_date\(tenant_uuid\)/, fn);
  }
});

test("доход с выданным чеком не удаляется и не правится в деньгах", () => {
  const guard = body("guard_income_with_issued_receipt");
  assert.match(guard, /calendar_delete_in_progress\(\)/);
  assert.match(guard, /from public\.tenants t where t\.id = old\.tenant_id/);
  assert.match(guard, /r\.status = 'issued'/);
  assert.match(guard, /new\.amount, new\.account_id, new\.payment_method, new\.vat_mode, new\.vat_rate/);
  assert.match(sql, /before update or delete on public\.finance_transactions/);
  assert.match(sql, /drop trigger if exists trg_sync_receipt_with_income/);
  assert.match(sql, /drop function if exists public\.sync_receipt_with_income\(\)/);
});

test("налог операции — со ставкой и не больше суммы", () => {
  const vat = body("assert_transaction_vat_sane");
  assert.match(vat, /new\.vat_amount <> 0 and new\.vat_rate is null/);
  assert.match(vat, /abs\(new\.vat_amount\) > abs\(new\.amount\)/);
  // Имя триггера сортируется после `trg_fill_transaction_vat`: проверка видит итог.
  assert.match(sql, /create trigger trg_fill_transaction_vat_sane/);
});

test("возврат под кредит-нотой чека не удаляется; нота к чеку — по журналу", () => {
  const guard = body("guard_refund_delete_with_credit_note");
  assert.match(guard, /credit_note_of_receipt_id = receipt_row\.id/);
  const del = body("delete_credit_note");
  assert.match(del, /receipt_refunded/);
  assert.match(del, /other_cover/);
});

test("кредит-нота к чеку проходит на любом тарифе", () => {
  assert.match(body("enforce_plan_limits"), /source\.id = new\.credit_note_of_receipt_id/);
});

test("сторнированная сумма меняется только функциями кредит-нот", () => {
  const guard = body("guard_invoice_credit_columns");
  assert.match(guard, /current_user not in \('authenticated', 'anon'\)/);
  assert.match(guard, /new\.credited_amount is distinct from old\.credited_amount/);
  assert.match(guard, /new\.credit_partial is distinct from old\.credit_partial/);
});

test("возврат по кредит-ноте умеет брать выбранный платёж и не ломает старый вызов", () => {
  assert.match(
    sql,
    /issue_partial_credit_note\(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_payment_id uuid DEFAULT NULL::uuid\)/,
  );
  assert.match(sql, /drop function if exists public\.issue_partial_credit_note\(uuid, uuid, numeric, text, text\);/);
  assert.match(sql, /drop function if exists public\._refund_invoice_money\(public\.invoices, numeric, date, text\);/);
  assert.match(body("_refund_invoice_money"), /order by \(tx\.id is not distinct from p_payment_id\) desc, tx\.created_at desc/);
});

test("новые служебные функции закрыты от приложения", () => {
  for (const sig of [
    "_assert_invoice_wait_account\\(uuid, uuid, text, boolean\\)",
    "strip_snapshot_contact_keys\\(\\)",
    "guard_income_with_issued_receipt\\(\\)",
    "assert_transaction_vat_sane\\(\\)",
    "guard_refund_delete_with_credit_note\\(\\)",
    "guard_invoice_credit_columns\\(\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`), sig);
  }
  assert.match(sql, /revoke all on function public\._refund_invoice_money\(public\.invoices, numeric, date, text, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.issue_partial_credit_note\(uuid, uuid, numeric, text, text, uuid\) to authenticated;/);
});

test("каскад компании не рвётся на гасящих чек триггерах", () => {
  assert.match(body("void_receipt_on_income_delete"), /public\.tenants t where t\.id = old\.tenant_id/);
  assert.match(body("void_receipt_on_refund"), /public\.tenants t where t\.id = old\.tenant_id/);
});

test("миграция кончается сторожем", () => {
  assert.match(sql.trimEnd(), /do \$guard\$[\s\S]*\$guard\$;$/);
});
