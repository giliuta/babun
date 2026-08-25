// ВЫСТАВЛЕНИЕ И ПРАВКА СЧЁТА — единственная дорога документа к клиенту, и до
// сегодня по ней не проходил ни один тест. Инцидент 2026-08-25 случился именно
// здесь: серверная функция перечисляла колонки поимённо и молча писала строку
// без описания и единицы — черновик на экране выглядел правильным, а к клиенту
// четыре дня уезжали позиции без текста.
//
// Поэтому проверяются три вещи, а не «что функция что-то вернула»:
//   1) в RPC реально уходят `description` и `unit`;
//   2) набор ключей строки СОВПАДАЕТ с колонками, которые пишет сервер, —
//      контрактный тест по последней миграции, как у клиентских RPC;
//   3) контрольное чтение ПАДАЕТ, если сервер вернул строку без описания или
//      без единицы (до правки сторож этого не замечал).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditInvoiceDraft, IssueInvoiceDraft } from "./invoices";
import { issueInvoice, updateInvoice } from "./invoices";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const lines = [
  {
    title: "Трасса",
    description: "Штробление и изоляция",
    unit: "м",
    qty: 4,
    unit_price: 20,
  },
];

const issueDraft: IssueInvoiceDraft = {
  request_id: REQUEST_ID,
  issued_on: "2026-08-25",
  due_on: "2026-09-01",
  client_id: null,
  appointment_id: null,
  brigade_id: null,
  vat_mode: "off",
  vat_percent: 0,
  notes: "Спасибо",
  lines,
};

const editDraft: EditInvoiceDraft = {
  due_on: "2026-09-01",
  client_id: null,
  appointment_id: null,
  brigade_id: null,
  vat_mode: "off",
  vat_percent: 0,
  notes: "Спасибо",
  lines,
};

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    tenant_id: TENANT,
    number: "INV-2026-001",
    year: 2026,
    seq: 1,
    issued_on: "2026-08-25",
    language: "ru",
    due_on: "2026-09-01",
    client_id: null,
    appointment_id: null,
    brigade_id: null,
    subtotal_net: 80,
    vat_percent: 0,
    vat_amount: 0,
    total: 80,
    currency: "EUR",
    status: "issued",
    pdf_url: null,
    notes: "Спасибо",
    created_at: "2026-08-25T10:00:00Z",
    updated_at: "2026-08-25T10:00:00Z",
    created_by: null,
    seller_snapshot: {},
    client_snapshot: null,
    ...overrides,
  };
}

function lineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    invoice_id: REQUEST_ID,
    position: 0,
    title: "Трасса",
    description: "Штробление и изоляция",
    unit: "м",
    qty: 4,
    unit_price: 20,
    total: 80,
    ...overrides,
  };
}

/** Мок покрывает ОБА шага записи: RPC и контрольное чтение (invoices +
 *  invoice_lines), — иначе половина сторожа остаётся непроверенной. */
function fakeSupabase(opts: {
  rpc?: { data: unknown; error: { message: string } | null };
  savedLines?: Array<Record<string, unknown>>;
  calls?: Array<Record<string, unknown>>;
}) {
  const rpcResult = opts.rpc ?? { data: invoiceRow(), error: null };
  const savedLines = opts.savedLines ?? [lineRow()];
  return {
    rpc(name: string, args: Record<string, unknown>) {
      opts.calls?.push({ name, ...args });
      return Promise.resolve(rpcResult);
    },
    from(table: string) {
      if (table === "invoice_lines") {
        const lineBuilder = {
          select: () => lineBuilder,
          eq: () => lineBuilder,
          // getInvoice ждёт результат прямо на `.order()` — терминальный шаг.
          order: () => Promise.resolve({ data: savedLines, error: null }),
        };
        return lineBuilder;
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: invoiceRow(), error: null }),
      };
      return builder;
    },
  } as never;
}

// ─── Контракт с серверной вставкой позиций ──────────────────────

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../supabase/migrations",
);
const INSERT_MARKER = "insert into public.invoice_lines (";

/** Колонки строки счёта из ПОСЛЕДНЕЙ миграции, которая переписывает вставку.
 *  Внутри файла берётся последнее вхождение: миграция-заплатка держит рядом
 *  старый оператор (что ищем) и новый (что пишем), действующий — новый. */
function serverLineColumns(): string[] {
  const named = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();
  for (const name of named) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    const start = sql.lastIndexOf(INSERT_MARKER);
    if (start < 0) continue;
    const end = sql.indexOf(")", start);
    const columns = sql
      .slice(start + INSERT_MARKER.length, end)
      // список склеен из SQL-литералов (`'…' || E'\n' || '…'`) — снимаем шов
      .replace(/E'\\n'/g, "")
      .replace(/\|\|/g, "")
      .replace(/'/g, "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    if (!columns.includes("title")) {
      throw new Error(`не разобрать колонки invoice_lines в ${name}`);
    }
    return columns;
  }
  throw new Error("no migration inserts invoice lines");
}

/** Их сервер считает сам: id счёта, порядковый номер и сумму строки. */
const SERVER_OWNED_COLUMNS = new Set(["invoice_id", "position", "total"]);

describe("строка счёта доезжает до сервера целиком", () => {
  it("кладёт описание и единицу в p_lines", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await issueInvoice(fakeSupabase({ calls }), TENANT, issueDraft);

    expect(calls[0]?.name).toBe("issue_invoice");
    expect((calls[0]?.p_lines as unknown[])[0]).toEqual({
      title: "Трасса",
      description: "Штробление и изоляция",
      unit: "м",
      qty: 4,
      unit_price: 20,
    });
  });

  it("шлёт ровно те поля, которые пишет серверная вставка", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await issueInvoice(fakeSupabase({ calls }), TENANT, issueDraft);
    const sent = Object.keys(
      (calls[0]?.p_lines as Array<Record<string, unknown>>)[0],
    ).sort();
    const expected = serverLineColumns()
      .filter((column) => !SERVER_OWNED_COLUMNS.has(column))
      .sort();

    expect(sent).toEqual(expected);
  });

  it("правка счёта шлёт тот же набор полей", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await updateInvoice(fakeSupabase({ calls }), REQUEST_ID, "2026-08-25", editDraft);

    expect(calls[0]?.name).toBe("update_invoice_draft");
    expect((calls[0]?.p_lines as unknown[])[0]).toEqual({
      title: "Трасса",
      description: "Штробление и изоляция",
      unit: "м",
      qty: 4,
      unit_price: 20,
    });
  });
});

describe("контрольное чтение инвойса", () => {
  it("не принимает строку, у которой сервер потерял описание", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({ savedLines: [lineRow({ description: null })] }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("Контрольное чтение инвойса не совпало");
  });

  it("не принимает строку, у которой сервер потерял единицу", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({ savedLines: [lineRow({ unit: null })] }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("Контрольное чтение инвойса не совпало");
  });

  it("ловит потерянное описание и при правке счёта", async () => {
    await expect(
      updateInvoice(
        fakeSupabase({ savedLines: [lineRow({ description: null })] }),
        REQUEST_ID,
        "2026-08-25",
        editDraft,
      ),
    ).rejects.toThrow("Контрольное чтение инвойса не совпало");
  });

  it("пропускает документ, совпавший до последнего поля", async () => {
    const saved = await issueInvoice(fakeSupabase({}), TENANT, issueDraft);

    expect(saved.total).toBe(80);
    expect(saved.lines).toHaveLength(1);
    expect(saved.lines[0]).toMatchObject({
      title: "Трасса",
      description: "Штробление и изоляция",
      unit: "м",
    });
  });
});

describe("подтверждение записи сервером", () => {
  it("отказывает, если RPC вернула чужой tenant", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({
          rpc: { data: invoiceRow({ tenant_id: "другой-тенант" }), error: null },
        }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("создание не подтверждено сервером");
  });

  it("отказывает, если RPC вернула не тот запрос", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({ rpc: { data: invoiceRow({ id: "другой-счёт" }), error: null } }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("создание не подтверждено сервером");
  });

  it("доносит текст ошибки сервера наружу", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({ rpc: { data: null, error: { message: "нет прав" } } }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("нет прав");
  });

  it("не принимает правку счёта, который вернулся не в статусе issued", async () => {
    await expect(
      updateInvoice(
        fakeSupabase({ rpc: { data: invoiceRow({ status: "paid" }), error: null } }),
        REQUEST_ID,
        "2026-08-25",
        editDraft,
      ),
    ).rejects.toThrow("сохранение не подтверждено сервером");
  });
});
