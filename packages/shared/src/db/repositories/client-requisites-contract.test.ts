// СТОРОЖ НАБОРОВ РЕКВИЗИТОВ КЛИЕНТА (миграция 20260922100000).
//
// Две стороны одного договора:
//   1. МИГРАЦИЯ держит правила, о которых договорились: константный default,
//      зеркало в четыре колонки триггером, нормализация с отказом 22023,
//      запрет сотруднику и маска, снимок инвойса с выбранным набором, одна
//      перегрузка `issue_invoice`, закрытые от anon функции.
//   2. РЕПОЗИТОРИЙ шлёт `requisites` и `p_client_requisites_id` ровно тогда,
//      когда есть что слать: пустой массив и «основной» не меняют сигнатуру
//      вызова, и клиент продолжает работать на базе без этой миграции.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlankClient, type ClientRequisites } from "../../local/clients";
import { createClient, rowToClient, updateClient } from "./clients";
import { issueInvoice } from "./invoices";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../supabase/migrations/20260922100000_client_requisites_sets.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
/** Текст без строк-комментариев: правило должно стоять в коде, а не в
 *  пояснении к нему. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("миграция наборов реквизитов", () => {
  test("колонка с константным default и проверкой массива", () => {
    expect(code).toContain(
      "add column if not exists requisites jsonb not null default '[]'::jsonb;",
    );
    expect(code).toContain("check (jsonb_typeof(requisites) = 'array')");
    // Сторож пропущенного значения прошлых строк.
    expect(code).toContain("a.attmissingval::text into missing_value");
  });

  test("нормализация: 22023, пустые прочь, id, заглавные, один основной", () => {
    expect(code).toMatch(/'client requisites must be an array'\s+using errcode = '22023'/);
    expect(code).toMatch(/'client requisites entry must be an object'\s+using errcode = '22023'/);
    expect(code).toMatch(/v_address is null then\s+continue;/);
    expect(code).toContain("v_vat := upper(nullif(btrim(entry ->> 'vat_number'), ''));");
    expect(code).toContain("v_reg := upper(nullif(btrim(entry ->> 'reg_number'), ''));");
    expect(code).toContain("if set_id is null or set_id = any(seen_ids) then");
    expect(code).toContain("v_default := not default_taken");
    expect(code).toContain("result := jsonb_set(result, '{0,is_default}', 'true'::jsonb);");
  });

  test("зеркало держит триггер на всех пяти колонках, в обе стороны", () => {
    expect(code).toContain(
      "before insert or update of requisites, legal_name, vat_number, reg_number, billing_address",
    );
    expect(code).toContain("if legacy_changed and not requisites_changed then");
    expect(code).toContain("new.legal_name := main ->> 'legal_name';");
    expect(code).toContain("new.billing_address := main ->> 'billing_address';");
  });

  test("реквизиты — дело владельца: белые списки, запрет, маска", () => {
    // Обе функции получают ключ в белый список.
    expect(code.split("'       ''requisites''' || chr(10) || '     )'").length).toBe(3);
    // Сотрудник не пишет наборы — рядом с vat_number.
    expect(code).toContain("'                        ''requisites''] then'");
    expect(code).toContain("'    input_row.requisites := ''[]''::jsonb;'");
    // Маска сотрудника гасит массив.
    expect(code).toMatch(/'billing_address', null,\s+'requisites', '\[\]'::jsonb/);
  });

  test("снимок инвойса берёт выбранный набор, а issue_invoice — одна", () => {
    expect(code).toContain("create or replace function public.build_invoice_client_snapshot_for(");
    expect(code).toContain(
      "revoke all on function public.build_invoice_client_snapshot_for(uuid, uuid, text) from public, anon;",
    );
    expect(code).toContain(
      "public.build_invoice_client_snapshot_for(new.tenant_id, new.client_id, new.client_requisites_id)",
    );
    expect(code).toContain("p_client_requisites_id text DEFAULT NULL::text)");
    expect(code).toContain(
      "drop function public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text);",
    );
    expect(code).toContain("raise exception 'issue_invoice must have exactly one overload';");
    expect(code).toContain("raise exception 'requisites functions are callable by anon';");
  });

  test("миграция — одна транзакция", () => {
    expect(code.trimStart().startsWith("begin;")).toBe(true);
    expect(code.trimEnd().endsWith("commit;")).toBe(true);
  });
});

const TENANT = "00000000-0000-4000-8000-000000000001";
const CLIENT_ID = "00000000-0000-4000-8000-000000000002";
const SETS: ClientRequisites[] = [
  {
    id: "main",
    legal_name: "Test Ltd",
    vat_number: "CY1",
    reg_number: null,
    billing_address: null,
    is_default: true,
  },
];

function recording(calls: { name: string; args: Record<string, unknown> }[]) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({ data: null, error: { message: "stop", code: "XX000" } });
    },
    from() {
      throw new Error("legacy fallback must not run");
    },
  } as never;
}

describe("репозиторий шлёт наборы только когда они есть", () => {
  test("создание: пустой массив не едет, непустой едет", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    // Пустой массив — явно: карточка-черновик держит `[]`, а не «нет ключа».
    const blank = createBlankClient({ id: CLIENT_ID, full_name: "A", requisites: [] });
    await createClient(recording(calls), blank, TENANT).catch(() => undefined);
    await createClient(recording(calls), { ...blank, requisites: SETS }, TENANT).catch(
      () => undefined,
    );
    expect("requisites" in (calls[0].args.p_client as object)).toBe(false);
    expect((calls[1].args.p_client as { requisites: unknown }).requisites).toEqual(SETS);
  });

  test("правка: наборы едут только в патче, где они есть", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    await updateClient(recording(calls), CLIENT_ID, { full_name: "B" }, TENANT).catch(
      () => undefined,
    );
    await updateClient(recording(calls), CLIENT_ID, { requisites: SETS }, TENANT).catch(
      () => undefined,
    );
    expect("requisites" in (calls[0].args.p_patch as object)).toBe(false);
    expect((calls[1].args.p_patch as { requisites: unknown }).requisites).toEqual(SETS);
  });

  test("чтение: поля набора перечислением, чужой ключ не проходит", () => {
    const row = {
      ...createBlankClient({ id: CLIENT_ID, full_name: "A" }),
      tenant_id: TENANT,
      updated_at: "2026-09-22T00:00:00.000Z",
      requisites: [{ ...SETS[0], junk: 1 }],
    };
    const client = rowToClient(row as never);
    expect(client.requisites).toEqual(SETS);
  });

  test("инвойс: p_client_requisites_id — только когда набор выбран", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const draft = {
      request_id: "00000000-0000-4000-8000-000000000003",
      issued_on: "2026-09-22",
      client_id: CLIENT_ID,
      vat_mode: "off" as const,
      vat_percent: 0,
      lines: [{ title: "Service", qty: 1, unit_price: 10 }],
    };
    await issueInvoice(recording(calls), TENANT, draft).catch(() => undefined);
    await issueInvoice(recording(calls), TENANT, { ...draft, client_requisites_id: "second" }).catch(
      () => undefined,
    );
    expect(calls[0].name).toBe("issue_invoice");
    expect("p_client_requisites_id" in calls[0].args).toBe(false);
    expect(calls[1].args.p_client_requisites_id).toBe("second");
  });
});
