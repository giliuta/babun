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

/** Правка в черновик листа (владелец 03.10: «кнопка „Применить“, чтобы всё
 *  было чётко»): на сервер уходит только по «Применить». */
export type StageAccount = (patch: Partial<AccountDraft>) => void;

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

/** Потолок листа счёта — 70% экрана (владелец 03.10: «пусть открывается на
 *  60 или 70%»; до того, с 15.09, было 50%). Лист стал блоками — имя, деньги,
 *  действия, счёт, — и на половине экрана из них виднелись два. Что не
 *  влезло, прокручивается внутри листа. Один потолок у правки и создания. */
export const ACCOUNT_SHEET_RATIO = 0.7;
