import { useQuery } from "@tanstack/react-query";
import { useAccountGate, useAccountScope } from "@/session/account-scope";
import { buildPayments, type TariffPayment } from "./tariff-payments";

// ОПЛАТЫ ТАРИФА — события Stripe, которые пишет вебхук (логика разбора и
// слова — в `tariff-payments.ts`), через `cabinet_tariff_payments`. Видит
// владелец аккаунта и партнёр с правом «Оплаты тарифа»; остальным
// запрос даже не уходит. Назван календарь — только его оплаты (у каждого
// календаря своя подписка).
//
// ВСЕ ОПЛАТЫ — потолок 200 событий (по два на месяц — больше восьми лет), без
// страниц: история подписки коротка.

const ALL_PAYMENTS = 200;

/** Дверь оплат — до перегенерации типов её нет в типах базы. */
type PaymentsRpc = {
  rpc: (
    name: "cabinet_tariff_payments",
    args: { p_limit: number; p_team: string | null },
  ) => PromiseLike<{ data: Parameters<typeof buildPayments>[0] | null; error: { message: string } | null }>;
};

const tariffPaymentsKey = (tenantId: string | null, teamId: string | null) =>
  ["tariff-payments", tenantId, teamId] as const;

export function useTariffPayments(limit: number = ALL_PAYMENTS, teamId: string | null = null) {
  const { tenantId, client } = useAccountScope();
  const gate = useAccountGate("cabinet.tariff_payments");
  return useQuery({
    queryKey: [...tariffPaymentsKey(tenantId, teamId), limit],
    enabled: !!tenantId && (gate === "read" || gate === "write"),
    staleTime: 60_000,
    // Без сети — отказ с «Повторить», а не вечная крутилка на приостановленном запросе.
    networkMode: "always",
    // СЫРЫХ СОБЫТИЙ STRIPE ТЕЛЕФОН НЕ ЧИТАЕТ: в них почта,
    // адрес и карта плательщика. Сервер отдаёт только оплаты тарифа
    // (`invoice.payment_succeeded | failed`) и только поля, из которых
    // строится строка (`cabinet_tariff_payments`).
    queryFn: async (): Promise<TariffPayment[]> => {
      const { data, error } = await (client as unknown as PaymentsRpc).rpc("cabinet_tariff_payments", {
        p_limit: limit,
        p_team: teamId,
      });
      if (error) throw new Error(`cabinet_tariff_payments: ${error.message}`);
      return buildPayments(Array.isArray(data) ? data : []);
    },
  });
}
