import type { PaymentAccountOption } from "./payment-accounts";

/**
 * ПОРЯДОК ПЛИТОК — ТОТ ЖЕ, ЧТО НА СТРАНИЦЕ «СЧЕТА» (владелец 2026-09-29:
 * «перемещаю карту первой, а наличные второй — и в оплате первой становится
 * карта»). Сервер ставил основной счёт вперёд перетаскивания, и плитки не
 * слушались руки. Сортируем при показе, а не при загрузке: уже лежащий в
 * кэше список перестраивается сразу после переноса, без ожидания свежести.
 */
export function sortPaymentAccounts(
  accounts: readonly PaymentAccountOption[],
): PaymentAccountOption[] {
  return accounts
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
    );
}
