import { useQuery } from "@tanstack/react-query";
import { useAccountGate, useAccountScope } from "./account-scope";
import { PAYMENT_EVENTS, buildPayments, type TariffPayment } from "./tariff-payments";

// ОПЛАТЫ ТАРИФА — чтение `billing_events` (события Stripe, которые пишет
// вебхук; логику разбора и слова — в `tariff-payments.ts`). Видит владелец
// аккаунта и партнёр с правом «Оплаты тарифа» (04.10, политика
// `billing_events_select_cabinet`); остальным запрос даже не уходит. Аккаунт —
// страницы (`account-scope`): в блоке пригласившего аккаунта — его оплаты.
//
// ВСЕ ОПЛАТЫ — потолок 200 событий (по два на месяц — больше восьми лет), без
// страниц: история подписки коротка. КРАТКОЕ ЧТЕНИЕ для двери в Кабинете берёт
// несколько последних событий, а не одно: пробный счёт на 0 и повторы
// неудачной оплаты в ленту не попадают, и единственное событие могло оказаться
// как раз таким.

const ALL_PAYMENTS = 200;
/** Сколько последних событий читает дверь Кабинета. */
export const LATEST_PAYMENTS_SAMPLE = 5;

export const tariffPaymentsKey = (tenantId: string | null) => ["tariff-payments", tenantId] as const;

export function useTariffPayments(limit: number = ALL_PAYMENTS) {
  const { tenantId, client } = useAccountScope();
  const gate = useAccountGate("cabinet.tariff_payments");
  return useQuery({
    queryKey: [...tariffPaymentsKey(tenantId), limit],
    enabled: !!tenantId && (gate === "read" || gate === "write"),
    staleTime: 60_000,
    // Без сети — отказ с «Повторить», а не вечная крутилка на приостановленном запросе.
    networkMode: "always",
    queryFn: async (): Promise<TariffPayment[]> => {
      const { data, error } = await client
        .from("billing_events")
        .select("id, event_type, payload, processed_at")
        .eq("tenant_id", tenantId as string)
        .in("event_type", [...PAYMENT_EVENTS])
        .order("processed_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`billing_events: ${error.message}`);
      return buildPayments(data ?? []);
    },
  });
}
