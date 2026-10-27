import type { Account } from "@babun/shared/local/finance/account";
import type { PaymentAccountOption } from "../payment-accounts";
import type { PaymentRow } from "../payment-draft";

// ДЕНЬГИ ВИДНЫ, ДАЖЕ КОГДА СЧЁТ УШЁЛ ИЗ ОПЛАТЫ. Плитки блока — счета, которые
// принимают оплату сейчас (`list_payment_accounts_safe`). Деньги, принятые на
// счёт, который потом скрыли, выключили из оплаты записи или закрыли, иначе
// пропадали из блока: ни суммы, ни способа снять платёж. Такой счёт встаёт
// оплаченной плиткой — тап по ней только снимает, новых денег он не берёт.

/** Скрытый счёт партнёру не виден вовсе (ограничительная политика) — без имени. */
export const HIDDEN_ACCOUNT_NAME = "Скрытый счёт";

export function strayPaymentAccounts(
  live: readonly Pick<PaymentAccountOption, "id">[],
  rowsByAccount: ReadonlyMap<string, readonly PaymentRow[]>,
  all: readonly Account[],
): PaymentAccountOption[] {
  const liveIds = new Set(live.map((account) => account.id));
  return [...rowsByAccount.keys()]
    .filter((id) => !liveIds.has(id))
    .map((id) => {
      const account = all.find((a) => a.id === id);
      return {
        id,
        name: account?.name ?? HIDDEN_ACCOUNT_NAME,
        kind: account?.kind ?? "cash",
        scope: account?.scope ?? "team",
        icon: account?.icon ?? null,
        color: account?.color ?? null,
        position: account?.position ?? Number.MAX_SAFE_INTEGER,
      };
    });
}

/** Почему у блока нет ни одной плитки: слова и дверь зависят от причины. */
export type NoAccountsReason = "right" | "off" | "none";

export function noAccountsReason(input: {
  canTakeMoney: boolean;
  teamId: string | null | undefined;
  all: readonly Account[];
}): NoAccountsReason {
  // Без права сервер отдаёт пустой список и при живых счетах команды.
  if (!input.canTakeMoney) return "right";
  // Счета у команды есть, но скрыты или выключены из оплаты записи —
  // «заведите счёт» вело бы ко второму такому же.
  const teamHasAccounts = input.all.some(
    (a) => a.brigade_id === input.teamId && a.is_active && !a.deleted_at,
  );
  return teamHasAccounts ? "off" : "none";
}
