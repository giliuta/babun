import { useQuery } from "@tanstack/react-query";
import type { AccountKind, AccountScope } from "@babun/shared/local/finance/account";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// СЧЕТА, ДОСТУПНЫЕ ДЛЯ ПРИЁМА ДЕНЕГ ПО ЭТОЙ ЗАЯВКЕ.
//
// Отдельный RPC, а не обычный список счетов: тот owner-only и несёт балансы.
// Здесь нужен ровно набор «куда можно положить» — без сумм, зато видимый
// всем, кто принимает деньги. Порядок задаёт сервер: сначала счета своей
// команды, потом общие; человек тапает первый попавшийся правильный.

// Значок и цвет — те же, что человек выбрал счёту в финансах: проекция
// `list_payment_accounts_safe` отдаёт их с 2026-08-15, и плитки блока «Оплата»
// рисуют счёт тем же `accountIcon`, что списки счетов, — узнавание пальцем.
export interface PaymentAccountOption {
  id: string;
  name: string;
  kind: AccountKind;
  scope: AccountScope;
  /** Слаг значка из `ICON_PRESETS`; null — глиф по виду счёта. */
  icon: string | null;
  /** Цвет счёта из палитры (#RRGGBB); null — нейтральный глиф. */
  color: string | null;
  position: number;
}

export function useTeamPaymentAccounts(teamId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["payment-accounts", tenantId, teamId ?? "no-team"],
    enabled: !!tenantId && !!teamId,
    // Набор счетов меняется раз в месяцы, а спрашивают его на каждом
    // открытии записи — держим свежим 5 минут. Правки счетов эти пять минут
    // не ждут: каждая мутация счёта сбрасывает ключ (см. invalidateAccounts
    // в features/finances/accounts.ts).
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PaymentAccountOption[]> => {
      const { data, error } = await supabase.rpc("list_payment_accounts_safe", {
        p_team_id: teamId as string,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PaymentAccountOption[];
    },
  });
}
