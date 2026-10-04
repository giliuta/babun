import { useQuery } from "@tanstack/react-query";
import { useAccountGate, useAccountScope } from "./account-scope";
import { buildPayments, type TariffPayment } from "./tariff-payments";

// ОПЛАТЫ ТАРИФА — события Stripe, которые пишет вебхук (логика разбора и
// слова — в `tariff-payments.ts`), через `cabinet_tariff_payments`. Видит
// владелец аккаунта и партнёр с правом «Оплаты тарифа» (04.10); остальным
// запрос даже не уходит. Аккаунт —
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

/** Дверь оплат — до перегенерации типов её нет в типах базы. */
type PaymentsRpc = {
  rpc: (
    name: "cabinet_tariff_payments",
    args: { p_limit: number },
  ) => PromiseLike<{ data: Parameters<typeof buildPayments>[0] | null; error: { message: string } | null }>;
};

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
    // СЫРЫХ СОБЫТИЙ STRIPE ТЕЛЕФОН НЕ ЧИТАЕТ (аудит 017, 04.10): в них почта,
    // адрес и карта плательщика. Сервер отдаёт только оплаты тарифа
    // (`invoice.payment_succeeded | failed`) и только поля, из которых
    // строится строка, — в прежней форме `payload` (`cabinet_tariff_payments`).
    queryFn: async (): Promise<TariffPayment[]> => {
      const { data, error } = await (client as unknown as PaymentsRpc).rpc("cabinet_tariff_payments", {
        p_limit: limit,
      });
      if (error) throw new Error(`cabinet_tariff_payments: ${error.message}`);
      return buildPayments(Array.isArray(data) ? data : []);
    },
  });
}
