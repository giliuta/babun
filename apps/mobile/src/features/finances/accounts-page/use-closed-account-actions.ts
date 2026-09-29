import { moneySign } from "@babun/shared/common/utils/money";
import { isOnline } from "@babun/shared/sync";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { deleteAccountAlert } from "../account-alerts";
import {
  useDeleteAccount,
  useReopenAccount,
  useSoftCloseAccount,
  type AccountWithBalance,
} from "../accounts";

// ЗАКРЫТЫЙ СЧЁТ — В ТОМ ЖЕ СПИСКЕ, ВНИЗУ СВОЕЙ КОМАНДЫ (владелец 2026-09-29:
// «убери вкладку „Закрытые счета“»). Отдельной страницы больше нет: закрытый
// счёт стоит серым под открытыми, как скрытая категория, и возвращается
// левой кромкой «Открыть», а пустой стирается правой. Действия — отсюда,
// тексты и тосты прежней страницы без изменений.
export function useClosedAccountActions() {
  const toast = useToast();
  const reopen = useReopenAccount();
  const close = useSoftCloseAccount();
  const remove = useDeleteAccount();

  // ОТКРЫТИЕ ОБРАТИМО — значит тостом с «Отменить», а не вопросом до
  // действия (тот же приём, что у перевода и архива клиентов).
  const openAgain = (account: AccountWithBalance) => {
    // Счёт с остатком закрыть нельзя (`guard_account_financial_history`) —
    // «Отменить» у него отбивалось бы всегда, поэтому его не предлагаем.
    const left = moneySign(account.balance) !== 0;
    reopen.mutate(account.id, {
      onSuccess: () =>
        toast(
          `Счёт «${account.name}» открыт`,
          "success",
          left
            ? undefined
            : {
                label: "Отменить",
                onPress: () =>
                  close.mutate({ id: account.id }, {
                    onError: (e) =>
                      toast(`Не удалось закрыть счёт: ${e.message}`, "error"),
                  }),
              },
        ),
      onError: (e) =>
        toast(
          isOnline()
            ? `Не удалось открыть счёт: ${e.message}`
            : "Без сети счёт не открыть — счета живут на сервере.",
          "error",
        ),
    });
  };

  // СТЕРЕТЬ — ТОЛЬКО ЗАКРЫТЫЙ И ТОЛЬКО ПУСТОЙ (владелец 2026-09-23: «добавить
  // в архив и потом удалить»). Вопрос обязателен: удаление безвозвратно.
  const erase = (account: AccountWithBalance) => {
    const text = deleteAccountAlert(account.name, account.balance);
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm, destructive: true },
      () =>
        remove.mutateAsync(account.id).then(
          () => toast(`Счёт «${account.name}» удалён`),
          (e: unknown) =>
            toast(
              isOnline()
                ? `Не удалось удалить счёт: ${e instanceof Error ? e.message : String(e)}`
                : "Без сети счёт не удалить — счета живут на сервере.",
              "error",
            ),
        ),
    );
  };

  return { openAgain, erase };
}
