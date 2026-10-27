// СЕРВЕРНАЯ ГИГИЕНА (аудит 035, пачка В). Десять миграций закрывают дыры,
// которые не видны на экране: прямой DELETE денег мимо корзины, дату оплаты
// с часов телефона, мёртвые денежные двери, возврат без сохранения итога,
// SMS отписанному клиенту и в чужую страну, клиента, стёртого при живой
// записи в корзине, перебор базы по номеру, функции без входа и медленный
// список клиентов партнёра. Каждая проверена прогоном с откатом на боевой;
// здесь сторожится, что их смысл не уплывёт при правке файла до наката.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** До наката файл лежит в `supabase/parked/`, после — в `supabase/migrations/`. */
function migration(file: string): string {
  for (const dir of ["supabase/migrations", "supabase/parked"]) {
    const full = path.join(REPO_ROOT, dir, file);
    if (existsSync(full)) return readFileSync(full, "utf8");
  }
  assert.fail(`нет ${file} ни в migrations, ни в parked`);
}

/** SQL без строковых комментариев: проверки не должны сходиться на пояснении. */
function code(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("server hygiene migrations", () => {
  test("money rows are deleted by people only through the trash flag", () => {
    const sql = code(migration("20261027225210_finance_delete_only_through_trash.sql"));
    assert.match(sql, /current_user in \('authenticated', 'anon'\)/);
    assert.match(sql, /current_setting\('babun\.operation_trash', true\), ''\) <> 'on'/);
    assert.match(sql, /before delete on public\.finance_transactions/);
    // DELETE-политики не снимаются: через них `delete_operation` проверяет право.
    assert.doesNotMatch(sql, /drop policy/i);
  });

  test("payment time is corrected by the phone clock skew, offline replays keep their day", () => {
    const sql = code(migration("20261027225220_appointment_payment_clock_skew.sql"));
    assert.match(sql, /abs\(extract\(epoch from \(now\(\) - p_sent_at\)\)\) <= 120/);
    assert.match(sql, /p_sent_at timestamp with time zone DEFAULT NULL::timestamp with time zone\)/);
    assert.match(sql, /coalesce\(p_paid_at, now\(\)\) \+ public\.client_clock_skew\(p_sent_at\)/);
    assert.match(sql, /не найден ровно один раз/);
    assert.match(sql, /grant execute on function public\.record_appointment_payment\([^)]*timestamptz\)\s+to authenticated/);
  });

  test("dead money doors are closed to people", () => {
    const sql = code(migration("20261027225230_dead_money_rpcs_closed.sql"));
    for (const fn of ["reset_appointment_payment\\(uuid\\)", "set_appointment_prepayment\\(uuid, numeric, text\\)"]) {
      assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\s+from public, anon, authenticated`));
    }
  });

  test("refund and new total are one transaction, stale check happens before money moves", () => {
    const sql = code(migration("20261027225240_refund_overpayment_and_save.sql"));
    const header = sql.slice(sql.indexOf("create or replace function public.refund_overpayment_and_save"), sql.indexOf("as $function$"));
    assert.doesNotMatch(header, /security definer/i, "invoker: права решают RLS и проверенные двери");
    const stale = sql.indexOf("appointment:stale");
    const refund = sql.indexOf("perform public.refund_appointment_overpayment(");
    assert.ok(stale > 0 && refund > stale, "проверка «запись не менялась» — до возврата");
    assert.match(sql, /return public\.member_appointment_update\(p_appointment_id, p_patch\)/);
    assert.match(sql, /set_config\('babun\.member_write', prev_flag, true\)/);
  });

  test("sms queue skips unavailable clients, numbers without a country code are refused", () => {
    const sql = code(migration("20261027225250_sms_queue_respects_client.sql"));
    assert.match(sql, /if n ~ '\^\[0-9\]\{8\}\$' then\s+n := '\+357' \|\| n;\s+else\s+return false;/);
    assert.match(sql, /c\.deleted_at is not null or c\.sms_opt_out or coalesce\(c\.blacklisted, false\)/);
    assert.match(sql, /set status = ''blocked''/);
  });

  test("client history knows debts and both trashes; labels purge on the server", () => {
    const sql = code(migration("20261027225305_trash_knows_client_history.sql"));
    for (const table of ["debts", "deleted_appointments", "deleted_operations"]) {
      assert.match(sql, new RegExp(`from public\\.${table}\\b`));
    }
    assert.match(sql, /client_has_history\(new\.id, false\)/, "корзины не обнуляют purge_at");
    assert.match(sql, /not public\.client_has_history\(c\.id, true\)/, "ночная чистка ждёт пустых корзин");
    assert.match(sql, /appointment:team_archived/);
    assert.match(sql, /cron\.schedule\('purge-deleted-cities'/);
  });

  test("phone lookup: 100 distinct numbers a day, owner exempt, only a fingerprint is kept", () => {
    const sql = code(migration("20261027225310_client_phone_lookup_limit.sql"));
    assert.match(sql, /if caller_role is distinct from ''owner'' then/);
    assert.match(sql, />= 100 then/);
    assert.match(sql, /md5\(p_phone_e164\)/);
    assert.match(sql, /access:phone_lookup_limit/);
    assert.match(sql, /revoke all on table public\.client_phone_lookups from public, anon, authenticated/);
  });

  test("anon keeps only token pages; buckets go only when empty", () => {
    const sql = code(migration("20261027225315_anon_helpers_and_empty_buckets.sql"));
    assert.doesNotMatch(sql, /\bto\b[^;]*\banon\b/i, "никому без входа право не выдаётся");
    assert.match(sql, /grant execute on function public\.calendar_delete_in_progress\(\) to authenticated, service_role/);
    assert.match(sql, /and not exists \(select 1 from storage\.objects o where o\.bucket_id = b\.id\)/);
  });

  test("partner client list computes its sets once", () => {
    const sql = code(migration("20261027225320_master_clients_list_once.sql"));
    for (const cte of ["me as materialized", "client_teams as materialized", "contact_sets as materialized"]) {
      assert.ok(sql.includes(cte), `нет ${cte}`);
    }
    assert.match(sql, /a\.master_id = me\.master_id or a\.team_id = any\(me\.team_ids\)/);
  });

  test("foreign key indexes leave auth.users keys alone", () => {
    const sql = code(migration("20261027225300_foreign_key_indexes.sql"));
    assert.match(sql, /finance_transactions \(refund_of_id\)/);
    assert.doesNotMatch(sql, /\((created_by|deleted_by|granted_by|invited_by_user_id)\)/);
  });

  test("payment door keeps the records window for partners", () => {
    const sql = code(migration("20261027225220_appointment_payment_clock_skew.sql"));
    assert.match(sql, /public\.member_record_hidden\(appt\.kind, appt\.team_id, appt\.date\)/);
    assert.match(sql, /appointment:outside_window/);
  });

  test("document dates: not future, this year, not before the last of the series", () => {
    const sql = code(migration("20261027225321_document_dates_in_series.sql"));
    for (const hint of ["document:future_date", "document:other_year", "document:before_last"]) {
      assert.ok(sql.includes(hint), `нет ${hint}`);
    }
    assert.match(sql, /coalesce\(p_issued_on, public\.tenant_business_date\(p_tx\.tenant_id\), current_date\)/);
    assert.match(sql, /assert_document_date\(tenant_uuid, resolved_company_id, ''invoice'', p_issued_on\)/);
  });

  test("records window also guards note, files and sms doors", () => {
    const sql = code(migration("20261027225322_record_window_side_doors.sql"));
    assert.equal(sql.match(/member_record_hidden\(/g)?.length, 3);
    assert.match(sql, /is_owner or not public\.member_record_hidden/);
  });

  test("documents: hidden-account invoices, no dispatcher, english by default", () => {
    const sql = code(migration("20261027225323_documents_policies_and_language.sql"));
    assert.match(sql, /create policy invoices_hidden_owner_only on public\.invoices\s+as restrictive/);
    assert.doesNotMatch(sql, /dispatcher/);
    assert.match(sql, /alter column language set default 'en'/);
  });

  test("cancel refund is dated the day of cancellation; calendar with an issued invoice stays", () => {
    const sql = code(migration("20261027225324_cancel_refund_date_and_calendar_invoices.sql"));
    assert.match(sql, /r_new constant text := E'          business_today,\\n'/);
    assert.match(sql, /calendar:issued_invoice/);
    assert.match(sql, /cn\.credit_note_of_id = i\.id/);
  });

  test("partner edges: card files, legal name, other teams' settings, account money", () => {
    const sql = code(migration("20261027225325_partner_rights_edges.sql"));
    assert.equal(sql.match(/partners_card_manageable\(/g)?.length, 4);
    assert.match(sql, /access_team_level\(public\.current_tenant_id\(\), auth\.uid\(\), 'clients\.requisites', new\.team_id\)/);
    assert.equal(sql.match(/from public\.member_calendars mc/g)?.length, 4);
    assert.match(sql, /new\.opening_balance is distinct from old\.opening_balance/);
  });

  test("client phone key is computed by the server where unambiguous", () => {
    const sql = code(migration("20261027225326_client_phone_key_by_server.sql"));
    assert.match(sql, /before insert or update of phone, phone_e164 on public\.clients/);
    assert.match(sql, /coalesce\(p_country, 'CY'\) = 'CY' and n ~ '\^\[0-9\]\{8\}\$'/);
    assert.match(sql, /o\.phone_e164 = k\.key and o\.id <> k\.id/, "занятый ключ не ставится — дубль разбирают руками");
    assert.match(sql, /o\.tenant_id = new\.tenant_id and o\.phone_e164 = computed and o\.id <> new\.id/, "и триггер не ставит занятый ключ");
  });

  test("client list handed to a partner is journaled", () => {
    const sql = code(migration("20261027225327_client_list_disclosure_journal.sql"));
    assert.match(sql, /rename to list_member_clients_rows/);
    assert.match(sql, /p_client_id is null and public\.current_user_role\(\) is distinct from 'owner'/);
    assert.match(sql, /revoke all on function public\.list_member_clients_rows\(uuid\) from public, anon, authenticated/);
  });

  test("director seeds records no higher than his own level", () => {
    const sql = code(migration("20261027225328_director_seed_not_above_own.sql"));
    assert.match(sql, /access_team_level\(p_tenant, p_by, 'calendar\.records', mc\.team_id\) in \('read', 'write'\) then 'read'/);
    assert.match(sql, /else 'off'/);
  });

  test("amount and payment rights follow services, payment follows amount", () => {
    const sql = code(migration("20261027225329_record_money_rights_follow_services.sql"));
    assert.match(sql, /block_row\.key not in \(''record\.amount'', ''record\.payment''\)/);
    assert.match(sql, /block_row\.key <> ''record\.payment''/);
  });

  test("director's invitation is capped at accept time", () => {
    const sql = code(migration("20261027225330_invitation_capped_at_accept.sql"));
    assert.match(sql, /and mc\.user_id = p_invitation\.invited_by_user_id/);
    assert.match(sql, /ma\.user_id = p_invitation\.invited_by_user_id/);
    assert.match(sql, /v_by_owner := p_invitation\.invited_by_user_id is null or exists/);
  });

  test("partner's new record without amount right gets catalog prices — same formula as the app", () => {
    const sql = code(migration("20261027225331_member_create_catalog_prices.sql"));
    assert.match(sql, /\(t\.value ->> 'min_qty'\)::integer >= 2/);
    assert.match(sql, /coalesce\(p_bulk_threshold, 0\) >= 2 and coalesce\(p_bulk_price, 0\) > 0/);
    assert.match(sql, /'totalPrice', round\(unit \* qty, 2\)/);
    // Формула сервера — копия `pricePerUnit`: поменялась она — меняй и SQL.
    const shared = readFileSync(path.join(REPO_ROOT, "packages/shared/src/local/services.ts"), "utf8");
    assert.match(shared, /tier\.min_qty >= 2/);
    assert.match(shared, /service\.bulk_threshold >= 2/);
    assert.match(shared, /service\.bulk_price > 0/);
  });

  test("storage janitor keeps the listed files of a live company and starts switched off", () => {
    const sql = code(migration("20261027235000_storage_janitor_keep_and_dry_start.sql"));
    assert.match(sql, /Сначала накатить 20261027224300_storage_janitor/);
    // Удалённая компания уходит целиком — список держит только живую.
    assert.match(sql, /and \(c\.reason = ''tenant_gone'' or not exists \(/);
    assert.match(sql, /revoke all on table public\.storage_janitor_keep from public, anon, authenticated/);
    assert.match(sql, /cron\.alter_job\(j\.jobid, active := false\)/);
    for (const file of [
      "cde75144-9dcc-4ee7-a92e-6c2b63c11736.jpg",
      "db4b06ec-a585-429b-9f34-b9c1b56c6a2d.heic",
      "37381e76-ca65-44d4-adce-8c2be13d393e.jpg",
    ]) {
      assert.ok(sql.includes(`11365a87-bef9-4f6c-a030-b15083fe646b/${file}`), `${file} в списке «не трогать»`);
    }
  });

  test("profit is no longer a separate right — registry row and grants go together", () => {
    const sql = code(migration("20261027235600_finance_profit_right_removed.sql"));
    const grants = sql.indexOf("delete from public.member_access where block = 'finance.profit'");
    const block = sql.indexOf("delete from public.access_blocks where key = 'finance.profit'");
    assert.ok(grants >= 0 && block > grants, "выдачи снимаются раньше блока реестра");
  });

  test("receipt without chosen details goes out from the payment team's legal entity, like an invoice", () => {
    const sql = code(migration("20261027235610_receipt_from_team_legal_entity.sql"));
    assert.match(sql, /company_uuid := public\.resolve_company_id\(p_tx\.tenant_id, p_company_id\);/);
    assert.match(sql, /coalesce\(p_company_id, public\.legal_entity_of_team\(p_tx\.tenant_id, p_tx\.team_id\)\)/);
    // Через `resolve_company_id`: не-владельца пускает только к юрлицу его команды.
    assert.match(sql, /company_uuid := public\.resolve_company_id\(\\n/);
  });
});
