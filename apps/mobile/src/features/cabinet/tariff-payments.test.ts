import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildPayments,
  groupByMonth,
  latestPaymentLine,
  parsePayment,
  paymentSub,
  paymentValue,
  periodWords,
  shortDate,
  type BillingEventRow,
} from "./tariff-payments";

// «Оплаты тарифа» (владелец 03.10): события Stripe из `billing_events` —
// строками страницы. Время везде местное, как на телефоне, поэтому даты
// собираются из частей, а не из строк с поясом.

const NOW = new Date(2026, 9, 20, 12).getTime();
const NB = " ";

/** Unix-секунды местного полудня (если час не задан). */
const unix = (y: number, m: number, d: number, h = 12): number =>
  Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);

const iso = (y: number, m: number, d: number, h = 12): string => new Date(y, m - 1, d, h).toISOString();

let seq = 0;
const event = (
  type: string,
  invoice: Record<string, unknown> | null,
  over: Partial<BillingEventRow> & { created?: number } = {},
): BillingEventRow => ({
  id: over.id ?? `ev-${++seq}`,
  event_type: type,
  processed_at: over.processed_at === undefined ? iso(2026, 10, 3) : over.processed_at,
  payload:
    over.payload !== undefined
      ? over.payload
      : {
          id: `evt_${seq}`,
          type,
          created: over.created ?? unix(2026, 10, 3),
          data: { object: invoice },
        },
});

/** Счёт Stripe за «Про» — как приходит после оформления в `tariff-checkout`. */
const proInvoice = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "in_pro_1",
  number: "ABCD-0001",
  currency: "eur",
  amount_due: 2999,
  amount_paid: 2999,
  billing_reason: "subscription_create",
  created: unix(2026, 10, 3, 11),
  status_transitions: { paid_at: unix(2026, 10, 3, 12) },
  hosted_invoice_url: "https://invoice.stripe.com/i/acct_1/live_abc",
  invoice_pdf: "https://pay.stripe.com/invoice/acct_1/live_abc/pdf",
  lines: {
    data: [
      {
        amount: 2999,
        description: "1 × Babun Про (at €29.99 / month)",
        period: { start: unix(2026, 10, 3), end: unix(2026, 11, 3) },
        price: {
          nickname: "Про · месяц",
          lookup_key: "babun_pro_month",
          metadata: { tier: "pro", period: "month" },
        },
      },
    ],
  },
  ...over,
});

describe("parsePayment: настоящий счёт Stripe", () => {
  test("оплаченный счёт читается целиком", () => {
    const payment = parsePayment(event("invoice.payment_succeeded", proInvoice(), { id: "row-1" }));
    assert.ok(payment);
    assert.equal(payment.id, "row-1");
    assert.equal(payment.invoiceId, "in_pro_1");
    assert.equal(payment.failed, false);
    assert.equal(payment.amount, 29.99);
    assert.equal(payment.currency, "EUR");
    assert.equal(payment.at, unix(2026, 10, 3, 12) * 1000);
    assert.equal(payment.tier, "pro");
    assert.equal(payment.title, "Про");
    assert.equal(payment.periodStart, unix(2026, 10, 3) * 1000);
    assert.equal(payment.periodEnd, unix(2026, 11, 3) * 1000);
    assert.equal(payment.url, "https://invoice.stripe.com/i/acct_1/live_abc");
  });

  test("неудачная оплата: сумма из amount_due, время — события, не счёта", () => {
    const failedInvoice = proInvoice({
      amount_paid: 0,
      status_transitions: {},
      created: unix(2026, 10, 1),
    });
    const payment = parsePayment(
      event("invoice.payment_failed", failedInvoice, { created: unix(2026, 10, 5) }),
    );
    assert.ok(payment);
    assert.equal(payment.failed, true);
    assert.equal(payment.amount, 29.99);
    assert.equal(payment.at, unix(2026, 10, 5) * 1000);
  });

  test("чужие события и события без счёта — не оплата", () => {
    assert.equal(parsePayment(event("customer.subscription.updated", proInvoice())), null);
    assert.equal(parsePayment(event("invoice.payment_succeeded", null)), null);
    assert.equal(parsePayment(event("invoice.payment_succeeded", null, { payload: null })), null);
    assert.equal(parsePayment(event("invoice.payment_succeeded", null, { payload: "мусор" })), null);
  });

  test("счёт на ноль — начало пробного, не оплата", () => {
    const trial = proInvoice({ amount_due: 0, amount_paid: 0, total: 0 });
    assert.equal(parsePayment(event("invoice.payment_succeeded", trial)), null);
  });

  test("при смене тарифа главная строка — с плюсом, а не возврат за старый", () => {
    const change = proInvoice({
      amount_paid: 1800,
      lines: {
        data: [
          {
            amount: -699,
            description: "Unused time on Соло after 10 окт.",
            period: { start: unix(2026, 10, 10), end: unix(2026, 11, 3) },
            price: { metadata: { tier: "solo" } },
          },
          {
            amount: 2499,
            description: "Remaining time on Про after 10 окт.",
            period: { start: unix(2026, 10, 10), end: unix(2026, 11, 3) },
            price: { metadata: { tier: "pro" } },
          },
        ],
      },
    });
    const payment = parsePayment(event("invoice.payment_succeeded", change));
    assert.ok(payment);
    assert.equal(payment.tier, "pro");
    assert.equal(payment.amount, 18);
    assert.equal(payment.periodStart, unix(2026, 10, 10) * 1000);
  });
});

describe("parsePayment: поля, которых может не быть", () => {
  test("пустой счёт: сумма из total, валюта — евро, тариф не опознан", () => {
    const payment = parsePayment(event("invoice.payment_succeeded", { total: 699 }));
    assert.ok(payment);
    assert.equal(payment.amount, 6.99);
    assert.equal(payment.currency, "EUR");
    assert.equal(payment.tier, null);
    assert.equal(payment.title, "Оплата тарифа");
    assert.equal(payment.periodStart, null);
    assert.equal(payment.url, null);
    // Время — из события, раз в счёте оплаты нет.
    assert.equal(payment.at, unix(2026, 10, 3) * 1000);
  });

  test("суммы нет совсем — строка остаётся, числа нет", () => {
    const payment = parsePayment(event("invoice.payment_succeeded", { id: "in_x" }));
    assert.ok(payment);
    assert.equal(payment.amount, null);
    assert.equal(paymentValue(payment), undefined);
  });

  test("время: оплата → событие → processed_at → создание счёта; нет ни одного — строки нет", () => {
    const bare = { id: "in_t", amount_paid: 100 };
    const fromProcessed = parsePayment(
      event("invoice.payment_succeeded", bare, {
        payload: { data: { object: bare } },
        processed_at: iso(2026, 9, 9),
      }),
    );
    assert.equal(fromProcessed?.at, new Date(2026, 8, 9, 12).getTime());

    const created = { ...bare, created: unix(2026, 8, 1) };
    const fromCreated = parsePayment(
      event("invoice.payment_succeeded", created, {
        payload: { data: { object: created } },
        processed_at: null,
      }),
    );
    assert.equal(fromCreated?.at, unix(2026, 8, 1) * 1000);

    assert.equal(
      parsePayment(
        event("invoice.payment_succeeded", bare, {
          payload: { data: { object: bare } },
          processed_at: null,
        }),
      ),
      null,
    );
  });

  test("тариф: метка подписки, lookup_key, название цены, слова описания", () => {
    const lineOnly = (line: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      parsePayment(
        event("invoice.payment_succeeded", { amount_paid: 100, lines: { data: [{ amount: 100, ...line }] }, ...extra }),
      )?.tier;

    assert.equal(lineOnly({}, { subscription_details: { metadata: { tier: "max" } } }), "max");
    assert.equal(lineOnly({}, { parent: { subscription_details: { metadata: { tier: "solo" } } } }), "solo");
    assert.equal(lineOnly({ price: { lookup_key: "babun_max_year" } }), "max");
    assert.equal(lineOnly({ price: { nickname: "Соло · год" } }), "solo");
    assert.equal(lineOnly({ description: "1 × Babun Макс (at €59.99 / month)" }), "max");
    // «про» внутри другого слова — не тариф.
    assert.equal(lineOnly({ description: "Прошлый платёж, проценты" }), null);
    // Мусорная метка не выдумывает тариф.
    assert.equal(lineOnly({ price: { metadata: { tier: "gold" } } }), null);
  });

  test("тариф не опознан — заголовок это описание строки", () => {
    const payment = parsePayment(
      event("invoice.payment_succeeded", {
        amount_paid: 500,
        lines: { data: [{ amount: 500, description: "Дополнительное место" }] },
      }),
    );
    assert.equal(payment?.title, "Дополнительное место");
  });

  test("поля не тех типов не ломают разбор", () => {
    const payment = parsePayment(
      event("invoice.payment_succeeded", {
        amount_paid: "2999",
        total: 2999,
        currency: 5,
        lines: "нет",
        status_transitions: "нет",
        hosted_invoice_url: 12,
        invoice_pdf: null,
      }),
    );
    assert.ok(payment);
    assert.equal(payment.amount, 29.99);
    assert.equal(payment.currency, "EUR");
    assert.equal(payment.url, null);
  });

  test("срок: нужны оба края и конец не раньше начала", () => {
    const withPeriod = (period: Record<string, unknown>) =>
      parsePayment(
        event("invoice.payment_succeeded", { amount_paid: 100, lines: { data: [{ amount: 100, period }] } }),
      );
    assert.equal(withPeriod({ start: unix(2026, 10, 3) })?.periodStart, null);
    assert.equal(withPeriod({ start: unix(2026, 11, 3), end: unix(2026, 10, 3) })?.periodEnd, null);
    assert.equal(withPeriod({ start: 0, end: 0 })?.periodStart, null);
  });

  test("ссылка: чек, иначе pdf; только https", () => {
    const urls = (hosted: unknown, pdf: unknown) =>
      parsePayment(
        event("invoice.payment_succeeded", { amount_paid: 100, hosted_invoice_url: hosted, invoice_pdf: pdf }),
      )?.url;
    assert.equal(urls("https://a.test/r", "https://a.test/p"), "https://a.test/r");
    assert.equal(urls(undefined, "https://a.test/p"), "https://a.test/p");
    assert.equal(urls("http://a.test/r", "javascript:alert(1)"), null);
    assert.equal(urls("  ", ""), null);
  });
});

describe("buildPayments: лента", () => {
  test("свежие сверху, чужие события и нули отсеяны", () => {
    const rows = [
      event("invoice.payment_succeeded", proInvoice({ id: "in_old", status_transitions: { paid_at: unix(2026, 9, 3) } }), { id: "old" }),
      event("customer.subscription.updated", proInvoice(), { id: "sub" }),
      event("invoice.payment_succeeded", proInvoice({ id: "in_zero", amount_paid: 0, amount_due: 0 }), { id: "zero" }),
      event("invoice.payment_succeeded", proInvoice({ id: "in_new", status_transitions: { paid_at: unix(2026, 10, 3) } }), { id: "new" }),
    ];
    assert.deepEqual(buildPayments(rows).map((p) => p.id), ["new", "old"]);
  });

  test("повторы одной неудачной оплаты — одна строка, последняя", () => {
    const attempt = (id: string, day: number) =>
      event("invoice.payment_failed", proInvoice({ id: "in_retry", amount_paid: 0, status_transitions: {} }), {
        id,
        created: unix(2026, 10, day),
      });
    const list = buildPayments([attempt("a1", 3), attempt("a2", 6), attempt("a3", 10)]);
    assert.deepEqual(list.map((p) => p.id), ["a3"]);
  });

  test("неудачная и потом удачная оплата одного счёта остаются обе", () => {
    const failed = event("invoice.payment_failed", proInvoice({ id: "in_same", amount_paid: 0 }), {
      id: "fail",
      created: unix(2026, 10, 3),
    });
    const paid = event(
      "invoice.payment_succeeded",
      proInvoice({ id: "in_same", status_transitions: { paid_at: unix(2026, 10, 5) } }),
      { id: "paid" },
    );
    assert.deepEqual(buildPayments([failed, paid]).map((p) => p.id), ["paid", "fail"]);
  });

  test("пусто — пустая лента", () => {
    assert.deepEqual(buildPayments([]), []);
  });
});

describe("groupByMonth", () => {
  const at = (y: number, m: number, d: number, h = 12) =>
    event("invoice.payment_succeeded", proInvoice({ id: `in_${y}_${m}_${d}`, status_transitions: { paid_at: unix(y, m, d, h) } }), {
      id: `${y}-${m}-${d}`,
    });

  test("месяцы с годом, от новых к старым, оплаты внутри — в том же порядке", () => {
    const months = groupByMonth(
      buildPayments([at(2026, 8, 3), at(2026, 10, 3), at(2026, 9, 3), at(2026, 10, 1)]),
    );
    assert.deepEqual(
      months.map((m) => [m.key, m.title, m.payments.map((p) => p.id)]),
      [
        ["2026-10", "Октябрь 2026", ["2026-10-3", "2026-10-1"]],
        ["2026-09", "Сентябрь 2026", ["2026-9-3"]],
        ["2026-08", "Август 2026", ["2026-8-3"]],
      ],
    );
  });

  test("граница месяца — по часам телефона", () => {
    const months = groupByMonth(buildPayments([at(2026, 11, 1, 0), at(2026, 10, 31, 23)]));
    assert.deepEqual(months.map((m) => m.key), ["2026-11", "2026-10"]);
  });

  test("год в заголовке свой у каждой оплаты", () => {
    const months = groupByMonth(buildPayments([at(2027, 1, 5), at(2026, 12, 5)]));
    assert.deepEqual(months.map((m) => m.title), ["Январь 2027", "Декабрь 2026"]);
  });

  test("нет оплат — нет месяцев", () => {
    assert.deepEqual(groupByMonth([]), []);
  });
});

describe("слова по-русски", () => {
  test("shortDate: год — только не текущий", () => {
    assert.equal(shortDate(new Date(2026, 9, 3).getTime(), NOW), "3 окт");
    assert.equal(shortDate(new Date(2025, 4, 31).getTime(), NOW), "31 мая 2025");
  });

  test("все двенадцать месяцев", () => {
    const words = Array.from({ length: 12 }, (_, i) => shortDate(new Date(2026, i, 1).getTime(), NOW));
    assert.deepEqual(words, [
      "1 янв", "1 фев", "1 мар", "1 апр", "1 мая", "1 июн",
      "1 июл", "1 авг", "1 сен", "1 окт", "1 ноя", "1 дек",
    ]);
  });

  test("periodWords: «3 окт – 3 ноя», один день — одной датой", () => {
    const d = (m: number, day: number) => new Date(2026, m - 1, day, 12).getTime();
    assert.equal(periodWords(d(10, 3), d(11, 3), NOW), "3 окт – 3 ноя");
    assert.equal(periodWords(d(12, 15), new Date(2027, 0, 15, 12).getTime(), NOW), "15 дек – 15 янв 2027");
    assert.equal(periodWords(d(10, 3), d(10, 3), NOW), "3 окт");
  });

  test("paymentSub: срок; без срока — день; неудачной — «· не прошла»", () => {
    const paid = parsePayment(event("invoice.payment_succeeded", proInvoice()));
    assert.ok(paid);
    assert.equal(paymentSub(paid, NOW), "3 окт – 3 ноя");

    const failed = parsePayment(event("invoice.payment_failed", proInvoice({ amount_paid: 0 })));
    assert.ok(failed);
    assert.equal(paymentSub(failed, NOW), "3 окт – 3 ноя · не прошла");

    const bare = parsePayment(event("invoice.payment_failed", { amount_due: 100 }));
    assert.ok(bare);
    assert.equal(paymentSub(bare, NOW), "3 окт · не прошла");
  });

  test("paymentValue: деньги в валюте счёта, евро по умолчанию", () => {
    const paid = parsePayment(event("invoice.payment_succeeded", proInvoice()));
    assert.equal(paid && paymentValue(paid), "€29,99");
    const big = parsePayment(event("invoice.payment_succeeded", proInvoice({ amount_paid: 123400 })));
    assert.equal(big && paymentValue(big), `€1${NB}234`);
  });

  test("latestPaymentLine: последняя, не прошла, оплат не было", () => {
    const paid = parsePayment(event("invoice.payment_succeeded", proInvoice()));
    assert.equal(latestPaymentLine(paid, NOW), "Последняя — €29,99 · 3 окт");

    const failed = parsePayment(event("invoice.payment_failed", proInvoice({ amount_paid: 0 })));
    assert.equal(latestPaymentLine(failed, NOW), "Не прошла — €29,99 · 3 окт");

    const noAmount = parsePayment(event("invoice.payment_succeeded", { id: "in_n" }));
    assert.equal(latestPaymentLine(noAmount, NOW), "Последняя — 3 окт");

    assert.equal(latestPaymentLine(null, NOW), "Оплат пока не было");
  });
});
