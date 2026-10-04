import { moneySign } from "@babun/shared/common/utils/money";
import { isOnline } from "@babun/shared/sync";
import { useToast } from "@/components/ui/Toast";
import {
  useReopenAccount,
  useSoftCloseAccount,
  type AccountWithBalance,
} from "../accounts";

// ЗАКРЫТЫЙ СЧЁТ — В ТОМ ЖЕ СПИСКЕ, ВНИЗУ СВОЕЙ КОМАНДЫ (владелец 2026-09-29:
// «убери вкладку „Закрытые счета“»). Отдельной страницы больше нет: закрытый
// счёт стоит серым под открытыми, как скрытая категория, и возвращается
// левой кромкой «Открыть». Правая кромка — «Удалить» в «Удалённые счета», как
// у открытого (`useHideAccount().remove`).
export function useClosedAccountActions() {
  const toast = useToast();
  const reopen = useReopenAccount();
  const close = useSoftCloseAccount();

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
                      toast(`Не удалось скрыть счёт: ${e.message}`, "error"),
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

  return { openAgain };
}
