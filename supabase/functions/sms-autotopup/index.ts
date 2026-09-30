// sms-autotopup — АВТОПОПОЛНЕНИЕ БАЛАНСА SMS С СОХРАНЁННОЙ КАРТЫ
// (STORY-089, волна 13).
//
// Владелец 30.09: «чтобы партнёры автоматически пополняли… и зачисление шло
// на их счёт». Партнёр однажды платит на сайте с галочкой «автопополнение» —
// карта сохраняется в Stripe. Дальше, когда баланс компании ниже порога,
// база будит эту функцию (после списания за SMS и раз в 5 минут), а она:
//   1. забирает компании, которым пора (`sms_autotopup_claim`: не чаще раза
//      в 15 минут и 3 раз в сутки, замороженные — никогда);
//   2. списывает с карты сумму, которую выбрал владелец компании, — платёж
//      с ключом идемпотентности: повтор той же попытки вернёт тот же
//      платёж, второго списания не будет;
//   3. удача — сразу зачисляет (`sms_credit_topup` по этому платежу; вебхук
//      Stripe потом придёт с тем же платежом и ничего не прибавит);
//      отказ банка — автопополнение выключается, причина видна владельцу.
//
// Кто зовёт: только база, с заголовком `x-cron-secret` из `edge_cron_secrets`
// (имя `sms-autotopup`). JWT здесь не принимается.
// Секреты: STRIPE_SECRET_KEY (тот же, что у оплаты на сайте).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter((v): v is string => typeof v === "string" && v.length > 20);
      serviceKey = candidates.find((v) => v.startsWith("sb_secret_")) ?? candidates[0];
    } catch {
      // fall through
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

// deno-lint-ignore no-explicit-any
async function authorized(sb: any, request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-cron-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await sb
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "sms-autotopup")
    .single();
  return !error && typeof data?.secret === "string" && constantTimeEqual(supplied, data.secret);
}

interface Due {
  tenant_id: string;
  customer: string;
  payment_method: string;
  amount_cents: number;
  idem_key: string;
}

type Charged =
  | { ok: true; id: string; amount: number; settled: boolean }
  | { ok: false; message: string };

/** Отказ банка — словами владельцу. */
function declineWords(error: { code?: string; decline_code?: string; message?: string }): string {
  const code = error.decline_code ?? error.code ?? "";
  if (code === "insufficient_funds") return "На карте не хватило денег";
  if (code === "expired_card") return "Срок карты истёк";
  if (code === "authentication_required") return "Банк просит подтвердить оплату — пополните баланс на сайте";
  if (code === "card_declined" || code === "generic_decline" || code === "do_not_honor") return "Банк отклонил карту";
  return error.message || "Банк отклонил списание";
}

async function charge(stripeKey: string, row: Due): Promise<Charged> {
  const pack = `auto-eur${Math.round(row.amount_cents / 100)}`;
  const form = new URLSearchParams({
    amount: String(row.amount_cents),
    currency: "eur",
    customer: row.customer,
    payment_method: row.payment_method,
    off_session: "true",
    confirm: "true",
    description: "Автопополнение баланса SMS · Babun",
    "metadata[kind]": "sms_topup",
    "metadata[tenant_id]": row.tenant_id,
    "metadata[pack_id]": pack,
    "metadata[auto]": "1",
    "metadata[attempt]": row.idem_key,
  });
  // Сбой сети бросает исключение: попытка остаётся «в пути» и повторится
  // тем же ключом.
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": row.idem_key,
    },
    body: form.toString(),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    amount_received?: number;
    error?: { code?: string; decline_code?: string; message?: string };
  };
  if (res.ok && payload.id && payload.status === "succeeded") {
    return { ok: true, id: payload.id, amount: payload.amount_received ?? row.amount_cents, settled: true };
  }
  // Банк ещё думает — зачислит вебхук, когда Stripe скажет «прошло».
  if (res.ok && payload.id && payload.status === "processing") {
    return { ok: true, id: payload.id, amount: 0, settled: false };
  }
  if (res.ok) {
    return {
      ok: false,
      message: payload.status === "requires_action"
        ? "Банк просит подтвердить оплату — пополните баланс на сайте"
        : "Платёж не прошёл",
    };
  }
  if (res.status >= 500 || res.status === 429) {
    // Stripe недоступен — не отказ банка: повтор тем же ключом.
    throw new Error(`stripe ${res.status}`);
  }
  return { ok: false, message: declineWords(payload.error ?? {}) };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const sb = serviceClient();
  if (!sb) return json(503, { error: "service_role_unavailable" });
  if (!(await authorized(sb, request))) return json(401, { error: "unauthorized" });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json(200, { ok: true, skipped: "stripe_not_configured" });

  const { data, error } = await sb.rpc("sms_autotopup_claim");
  if (error) {
    console.error("sms_autotopup_claim failed", error.message);
    return json(500, { error: "claim_failed" });
  }
  const rows = (data ?? []) as Due[];
  const counts = { charged: 0, failed: 0, retry: 0 };
  for (const row of rows) {
    let result: Charged;
    try {
      result = await charge(stripeKey, row);
    } catch (err) {
      // Попытка остаётся «в пути»: через 30 минут повторится тем же ключом.
      console.error("sms-autotopup: stripe unreachable", row.tenant_id, err instanceof Error ? err.message : err);
      counts.retry += 1;
      continue;
    }
    if (result.ok) {
      if (result.settled) {
        const { error: creditError } = await sb.rpc("sms_credit_topup", {
          p_tenant: row.tenant_id,
          p_amount_cents: result.amount,
          p_session: null,
          p_payment_intent: result.id,
          p_pack: `auto-eur${Math.round(row.amount_cents / 100)}`,
        });
        // Не зачислилось здесь — зачислит вебхук тем же платежом.
        if (creditError) console.error("sms-autotopup: credit failed", row.tenant_id, creditError.message);
      }
      await sb.rpc("sms_autotopup_result", { p_tenant: row.tenant_id, p_key: row.idem_key, p_ok: true, p_error: null });
      counts.charged += 1;
    } else {
      await sb.rpc("sms_autotopup_result", {
        p_tenant: row.tenant_id,
        p_key: row.idem_key,
        p_ok: false,
        p_error: result.message,
      });
      counts.failed += 1;
    }
  }
  return json(200, { ok: true, ...counts });
});
