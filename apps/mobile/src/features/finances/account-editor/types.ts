import type { AccountDraft } from "@babun/shared/db/repositories/accounts";
import type { useUpdateAccount } from "../accounts";

/** Мутация правки счёта — одна на лист правки, её делят все группы. */
export type AccountUpdate = ReturnType<typeof useUpdateAccount>;

/** Алерт с человеческой причиной отказа: офлайн вместо сырого «Network
 *  request failed» (см. `EditAccountSheet`). */
export type AlertError = (title: string) => (e: unknown) => void;

/** Правка счёта со СВОИМ заголовком ошибки. Промис отвечает, сохранилось ли. */
export type SaveAccount = (
  patch: Partial<AccountDraft>,
  errorTitle: string,
) => Promise<boolean>;

/**
 * КАЖДАЯ ПРАВКА СООБЩАЕТ О СВОЁМ ОТКАЗЕ САМА (разбор багов счетов 2026-09-15).
 * Все группы листа делят одну мутацию, а `mutate(…, { onError })` в
 * react-query 5 отцепляет колбэки прошлого вызова: переименовали и тут же
 * щёлкнули «С НДС» — отказ переименования проходил молча. У промиса
 * `mutateAsync` свой обработчик на каждый вызов, и перебить его некому.
 */
export function accountSaver(
  update: AccountUpdate,
  id: string,
  alertError: AlertError,
): SaveAccount {
  return (patch, errorTitle) =>
    update.mutateAsync({ id, patch }).then(
      () => true,
      (e: unknown) => {
        alertError(errorTitle)(e);
        return false;
      },
    );
}

/** Потолок листа счёта — половина экрана (владелец 2026-09-15: «подымается
 *  шторка на 50%»). Что не влезло, прокручивается внутри листа. */
export const ACCOUNT_SHEET_RATIO = 0.5;
