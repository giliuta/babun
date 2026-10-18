// ВЫСТАВЛЕНИЕ И ПРАВКА СЧЁТА — единственная дорога документа к клиенту, и ей
// нужны тесты. Серверная функция, перечисляющая колонки поимённо, молча
// пишет строку без описания и единицы — черновик на экране выглядит
// правильным, а к клиенту уезжают позиции без текста.
//
// Поэтому проверяются три вещи, а не «что функция что-то вернула»:
//   1) в RPC реально уходят `description` и `unit`;
//   2) набор ключей строки СОВПАДАЕТ с колонками, которые пишет сервер, —
//      контрактный тест по последней миграции, как у клиентских RPC;
//   3) контрольное чтение ПАДАЕТ, если сервер вернул строку без описания или
//      без единицы.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IssueInvoiceDraft } from "./invoices";
import { InvoiceAlreadyIssuedError, issueInvoice } from "./invoices";

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
  savedLines?: Record<string, unknown>[];
  calls?: Record<string, unknown>[];
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
    const calls: Record<string, unknown>[] = [];
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
    const calls: Record<string, unknown>[] = [];
    await issueInvoice(fakeSupabase({ calls }), TENANT, issueDraft);
    const sent = Object.keys(
      (calls[0]?.p_lines as Record<string, unknown>[])[0],
    ).sort();
    const expected = serverLineColumns()
      .filter((column) => !SERVER_OWNED_COLUMNS.has(column))
      .sort();

    expect(sent).toEqual(expected);
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
    ).rejects.toThrow("Создание инвойса не подтверждено сервером");
  });

  it("отказывает, если RPC вернула не тот запрос", async () => {
    await expect(
      issueInvoice(
        fakeSupabase({ rpc: { data: invoiceRow({ id: "другой-счёт" }), error: null } }),
        TENANT,
        issueDraft,
      ),
    ).rejects.toThrow("Создание инвойса не подтверждено сервером");
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

});

describe("текст отказа — для человека", () => {
  it("без служебного имени функции", async () => {
    const error = await issueInvoice(
      fakeSupabase({ rpc: { data: null, error: { message: "Документ нельзя датировать будущим числом" } } }),
      TENANT,
      issueDraft,
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe("Документ нельзя датировать будущим числом");
  });
});

// ПОВТОР ПОСЛЕ ПОТЕРЯННОГО ОТВЕТА: инвойс уже создан тем же id запроса.
// Сервер на повтор отдаёт ПРЕЖНИЙ документ, и если между попытками человек
// поправил форму, контрольное чтение не сходилось на каждом нажатии, а уход
// со страницы и новая попытка рождали второй счёт. Повтор сперва смотрит,
// нет ли уже документа с этим id, и ведёт на него.
describe("повтор выставления", () => {
  function repeatSupabase(existing: Record<string, unknown> | null, calls: string[]) {
    return {
      rpc(name: string) {
        calls.push(name);
        return Promise.resolve({ data: invoiceRow(), error: null });
      },
      from(table: string) {
        if (table === "invoice_lines") {
          const lineBuilder = {
            select: () => lineBuilder,
            eq: () => lineBuilder,
            order: () => Promise.resolve({ data: [lineRow()], error: null }),
          };
          return lineBuilder;
        }
        const builder = {
          select: () => builder,
          eq: () => builder,
          // До выставления — то, что лежит в базе; после — созданный счёт.
          maybeSingle: () => {
            calls.push("read");
            const created = calls.includes("issue_invoice");
            return Promise.resolve({ data: created ? invoiceRow() : existing, error: null });
          },
        };
        return builder;
      },
    } as never;
  }

  it("документ с этим id уже есть — отдаёт его, не вызывая выставление", async () => {
    const calls: string[] = [];
    const edited = { ...issueDraft, notes: "Поправил после сбоя" };
    const error = await issueInvoice(repeatSupabase(invoiceRow(), calls), TENANT, edited, { repeat: true })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(InvoiceAlreadyIssuedError);
    expect((error as InvoiceAlreadyIssuedError).invoice.id).toBe(REQUEST_ID);
    expect(calls).not.toContain("issue_invoice");
  });

  it("документа нет — выставляет как обычно", async () => {
    const calls: string[] = [];
    const saved = await issueInvoice(repeatSupabase(null, calls), TENANT, issueDraft, { repeat: true });
    expect(saved.id).toBe(REQUEST_ID);
    expect(calls).toContain("issue_invoice");
  });

  it("первая попытка не тратит чтение на проверку", async () => {
    const calls: string[] = [];
    await issueInvoice(repeatSupabase(invoiceRow(), calls), TENANT, issueDraft);
    expect(calls[0]).toBe("issue_invoice");
  });
});
