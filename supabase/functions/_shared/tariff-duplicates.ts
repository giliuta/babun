// ОДНА ПОДПИСКА НА АККАУНТ — правила, общие для `tariff-checkout` (не дать
// оформить вторую) и `stripe-webhook` (снять вторую, если всё же прошла).
//
// Вторая подписка рождается без злого умысла: две вкладки оплаты, «Назад →
// Оплатить ещё раз», владелец и партнёр одновременно. Пока вебхук не записал
// первую оплату в аккаунт, `tariff-checkout` видит «подписки нет» и открывает
// новую страницу Stripe; оплачены обе — и обе списывают каждый месяц, а в
// аккаунте видна одна.
//
// Модуль без импортов и без Deno: его читают и функции, и тесты приложения.

/** Подписка, которая сейчас даёт тариф и списывает деньги. */
export const LIVE_TARIFF_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

export interface SubscriptionLite {
  id: string;
  status: string;
  /** Секунды Unix, как у Stripe. */
  created: number;
  metadata?: Record<string, string | undefined> | null;
}

export interface CheckoutSessionLite {
  id: string;
  status?: string | null;
  mode?: string | null;
  metadata?: Record<string, string | undefined> | null;
}

/** Живая подписка клиента Stripe — оплата уже прошла, даже если вебхук ещё
 *  не записал её в аккаунт. Самая свежая, если их почему-то несколько. */
export function liveSubscriptionOf(subs: readonly SubscriptionLite[]): SubscriptionLite | null {
  return (
    subs
      .filter((s) => LIVE_TARIFF_STATUSES.has(s.status))
      .sort((a, b) => b.created - a.created)[0] ?? null
  );
}

/** Открытые страницы оплаты ТАРИФА этого клиента. Новая страница их гасит:
 *  старая вкладка, оплаченная после новой, завела бы вторую подписку.
 *  Страницы SMS (`mode: payment`) не трогаем — у них своя оплата. */
export function openTariffSessions(sessions: readonly CheckoutSessionLite[]): string[] {
  return sessions
    .filter((s) => s.status === "open" && s.mode === "subscription" && s.metadata?.kind === "tariff")
    .map((s) => s.id);
}

/** Короткий отпечаток строки (djb2) — чтобы ключ влез в 255 символов Stripe. */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Ключ идемпотентности создания страницы оплаты. Два одновременных нажатия
 *  с одинаковым содержимым в одну минуту получают ОДНУ страницу: Stripe по
 *  тому же ключу отдаёт уже созданный ответ.
 *
 *  В ключе — и страницы, которые этот запрос только что погасил
 *  (`superseded`). Без них «Назад → Оплатить ещё раз» в ту же минуту получил
 *  бы по старому ключу ту самую страницу, которую сам и погасил. */
export function checkoutIdempotencyKey(parts: {
  tenantId: string;
  priceId: string;
  quantity: number;
  trialEnd: number | null;
  returnUrl: string;
  superseded: readonly string[];
  nowMs: number;
}): string {
  const minute = Math.floor(parts.nowMs / 60_000);
  return [
    "babun-tariff",
    parts.tenantId,
    parts.priceId,
    String(parts.quantity),
    String(parts.trialEnd ?? 0),
    String(minute),
    fingerprint([...parts.superseded].sort().join(",")),
    fingerprint(parts.returnUrl),
  ].join(":");
}

export type DuplicateVerdict =
  /** Аккаунт переходит на эту подписку (текущей нет или она не живая). */
  | { kind: "adopt" }
  /** Событие тариф не трогает. */
  | { kind: "ignore" }
  /** Вторая живая подписка того же аккаунта: вернуть деньги и отменить. */
  | { kind: "cancel"; subscriptionId: string }
  /** Две живые, но вторая заведена не нашей оплатой (без метки аккаунта) —
   *  руками не трогаем, только тревога; аккаунт берёт более новую, как
   *  раньше. */
  | { kind: "alarm"; adopt: boolean };

/** Что делать с событием про подписку `fresh`, когда у аккаунта записана
 *  ДРУГАЯ подписка `current` (null — её нет в Stripe).
 *
 *  Подписка одна на аккаунт: `tariff-checkout` меняет живую, а не заводит
 *  вторую. Поэтому вторая живая подписка с меткой этого аккаунта — всегда
 *  двойная оплата. Остаётся та, что уже записана: на неё смотрят экран и
 *  сверка календарей. */
export function duplicateVerdict(input: {
  tenantId: string;
  current: SubscriptionLite | null;
  fresh: SubscriptionLite;
}): DuplicateVerdict {
  const { tenantId, current, fresh } = input;
  if (!LIVE_TARIFF_STATUSES.has(fresh.status)) return { kind: "ignore" };
  if (!current || !LIVE_TARIFF_STATUSES.has(current.status)) return { kind: "adopt" };
  if (fresh.metadata?.tenant_id === tenantId) return { kind: "cancel", subscriptionId: fresh.id };
  return { kind: "alarm", adopt: fresh.created > current.created };
}
