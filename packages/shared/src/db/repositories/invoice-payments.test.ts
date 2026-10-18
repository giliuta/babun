import { describe, expect, it } from "bun:test";
import {
  InvoicePaymentAlreadyRecordedError,
  recordInvoicePayment,
  refundInvoicePayment,
} from "./invoice-payments";

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    tenant_id: "tenant-1",
    type: "income",
    amount: 10,
    currency: "EUR",
    category_id: null,
    account_id: "account-1",
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: "team-1",
    master_id: null,
    payment_method: "other",
    notes: null,
    occurred_on: "2026-07-20",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: "invoice-1",
    refund_of_id: null,
    source: "manual",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    created_by: null,
    ...overrides,
  };
}

describe("invoice payment repository", () => {
  it("keeps the other payment route and selected occurred_on", async () => {
    let received: { name?: string; args?: Record<string, unknown> } = {};
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        received = { name, args };
        return { data: transaction(), error: null };
      },
    };

    await recordInvoicePayment(supabase as never, "invoice-1", {
      request_id: "request-1",
      amount: 10,
      account_id: "account-1",
      payment_method: "other",
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
    });

    expect(received.name).toBe("record_invoice_payment");
    expect(received.args?.p_payment_method).toBe("other");
    expect(received.args?.p_occurred_on).toBe("2026-07-20");
  });

  it("rejects future ledger dates before calling the server", async () => {
    let called = false;
    const supabase = {
      rpc: async () => {
        called = true;
        return { data: null, error: null };
      },
    };

    await expect(recordInvoicePayment(supabase as never, "invoice-1", {
      request_id: "request-1",
      amount: 10,
      account_id: "account-1",
      payment_method: "cash",
      occurred_on: "9999-12-31",
      business_today: "2026-07-20",
    })).rejects.toThrow("не может быть в будущем");
    expect(called).toBe(false);
  });

  it("does not silently round a three-decimal payment", async () => {
    let called = false;
    const supabase = { rpc: async () => {
      called = true;
      return { data: null, error: null };
    } };

    await expect(recordInvoicePayment(supabase as never, "invoice-1", {
      request_id: "request-1",
      amount: 10.005,
      account_id: "account-1",
      payment_method: "cash",
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
    })).rejects.toThrow("двух знаков");
    expect(called).toBe(false);
  });

  it("rejects a refund date earlier than its original payment", async () => {
    let called = false;
    const supabase = {
      rpc: async () => {
        called = true;
        return { data: null, error: null };
      },
    };

    await expect(refundInvoicePayment(
      supabase as never,
      "invoice-1",
      "payment-1",
      {
        request_id: "refund-1",
        amount: 5,
        occurred_on: "2026-07-19",
        business_today: "2026-07-20",
        original_occurred_on: "2026-07-20",
      },
    )).rejects.toThrow("раньше исходного платежа");
    expect(called).toBe(false);
  });

  it("sends only identity, amount, date and notes for a refund", async () => {
    let received: Record<string, unknown> | undefined;
    const supabase = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        received = args;
        return {
          data: transaction({
            id: "refund-1",
            type: "refund",
            amount: -5,
            refund_of_id: "payment-1",
          }),
          error: null,
        };
      },
    };

    await refundInvoicePayment(supabase as never, "invoice-1", "payment-1", {
      request_id: "refund-1",
      amount: 5,
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
      original_occurred_on: "2026-07-20",
      notes: "Partial",
    });

    expect(received).toEqual({
      p_payment_id: "payment-1",
      p_request_id: "refund-1",
      p_amount: 5,
      p_occurred_on: "2026-07-20",
      p_notes: "Partial",
    });
  });

  // ОТВЕТ СЕРВЕРА ЧИТАЕТ ЧЕЛОВЕК: служебное имя функции перед текстом
  // («recordInvoicePayment: …») он видел под кнопкой как есть.
  it("shows the server's refusal without the function name", async () => {
    const refusing = { rpc: async () => ({ data: null, error: { message: "Сумма платежа слишком большая", code: "P0001" } }) };
    const draft = {
      request_id: "request-1",
      amount: 10,
      account_id: "account-1",
      payment_method: "cash" as const,
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
    };
    const error = await recordInvoicePayment(refusing as never, "invoice-1", draft).catch((e: Error) => e);
    expect((error as Error).message).toBe("Сумма платежа слишком большая");
    const refund = await refundInvoicePayment(refusing as never, "invoice-1", "payment-1", {
      request_id: "refund-1",
      amount: 5,
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
      original_occurred_on: "2026-07-20",
    }).catch((e: Error) => e);
    expect((refund as Error).message).toBe("Сумма платежа слишком большая");
  });

  // ОТВЕТ ПОТЕРЯН, СУММУ ПОПРАВИЛИ, ПОВТОРИЛИ ТЕМ ЖЕ id: сервер отвечает
  // «уже использован с другими данными» — значит, первый платёж ЗАПИСАН.
  // Человеку — что он записан, экрану — знак сменить id.
  it("tells a reused payment id apart: the first payment is recorded", async () => {
    const reused = {
      rpc: async () => ({
        data: null,
        error: { message: "Идентификатор платежа уже использован с другими данными", code: "P0001" },
      }),
    };
    const error = await recordInvoicePayment(reused as never, "invoice-1", {
      request_id: "request-1",
      amount: 12,
      account_id: "account-1",
      payment_method: "cash",
      occurred_on: "2026-07-20",
      business_today: "2026-07-20",
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(InvoicePaymentAlreadyRecordedError);
    expect((error as Error).message).not.toContain("Идентификатор");
    expect((error as Error).message).not.toContain("recordInvoicePayment");
  });
});
