// Pure scope rules of the «Финансы» home screen: which ledger slice a chip
// reads, which accounts it shows, and the deep-link client filter.

import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { NO_TEAM } from "../accounts-sections";

export interface LedgerFilter {
  brigadeIds?: string[];
  accountIds?: string[];
}

/** Отбор журнала под чип — один на текущий и прошлый период («Прибыль»). */
export function ledgerFilterFor(
  scope: string | null,
  orphanAccounts: readonly { id: string }[],
): LedgerFilter {
  return scope === NO_TEAM
    ? orphanAccounts.length > 0
      ? {
          // Журнал бесхозных счетов режется по СЧЕТАМ, а не по team_id:
          // их проводки могут нести team_id живых команд (сдача выручки
          // старой схемы), и командный срез потерял бы эти деньги.
          accountIds: orphanAccounts.map((account) => account.id),
        }
      : // Сирот нет — ноль строк, как `.in("team_id", ["__no_team__"])` на
        // сервере. Пустой `accountIds` значил бы «фильтра нет», а ключ
        // компании теперь почти всегда в кэше: `enabled: false` больше
        // ничего не прятал бы, и чип показал бы журнал всей компании.
        { brigadeIds: [NO_TEAM] }
    : { brigadeIds: scope ? [scope] : undefined };
}

/** «Финансы клиента» из диплинка: без клиента — тот же массив, без копии. */
export function forClient<T extends { client_id?: string | null }>(
  rows: T[],
  clientId: string | undefined,
): T[] {
  return clientId ? rows.filter((row) => row.client_id === clientId) : rows;
}

/** Счёт = одна команда: командный скоуп видит РОВНО счета
 *  своей команды, «общих счетов» нет; чип «Без команды» показывает
 *  сирот старой схемы. */
export function scopedAccountsFor<A extends { brigade_id: string | null }>(
  accounts: A[],
  orphanAccounts: A[],
  scope: string | null,
): A[] {
  if (scope === NO_TEAM) return orphanAccounts;
  return scope ? accounts.filter((a) => accountServesTeam(a, scope)) : accounts;
}
