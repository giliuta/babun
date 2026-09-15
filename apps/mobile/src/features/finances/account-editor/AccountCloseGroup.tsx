import { money, moneySign } from "@babun/shared/common/utils/money";
import { ActionRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { useReopenAccount, type AccountWithBalance } from "../accounts";
import type { AlertError } from "./types";

// ЗАКРЫТИЕ И УДАЛЕНИЕ — РАЗНЫЕ ПОСЛЕДСТВИЯ, значит разные подписи. Одно место и
// один красный цвет несли и обратимое закрытие, и безвозвратное удаление;
// предусловие «остаток должен быть нулём» человек узнавал, только нарвавшись.
//
// Сам вопрос и перевод остатка живут в `use-close-flow`: из открытого листа
// вопрос не показать, и лист на это время уезжает.
export function AccountCloseGroup({
  account,
  onCloseAccount,
  alertError,
}: {
  account: AccountWithBalance;
  /** «Закрыть» или «Удалить» — начать разговор о закрытии. */
  onCloseAccount: () => void;
  alertError: AlertError;
}) {
  const reopenAcc = useReopenAccount();
  const hasHistory = account.has_history;
  const hasBalance = moneySign(account.balance) !== 0;

  return (
    <>
      <RowGroup title={account.is_active ? "Закрытие счёта" : undefined}>
        {account.is_active ? (
          <ActionRow
            label={hasHistory ? "Закрыть счёт" : "Удалить счёт"}
            tone="danger"
            onPress={onCloseAccount}
          />
        ) : (
          // ЗАКРЫТЫЙ СЧЁТ ОТКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, без вопроса: действие обратимо,
          // и лист остаётся на месте — дальше счёт правится как любой другой.
          <ActionRow
            label="Открыть счёт снова"
            dimmed={reopenAcc.isPending}
            onPress={() =>
              void reopenAcc
                .mutateAsync(account.id)
                .catch(alertError("Не удалось открыть счёт"))
            }
          />
        )}
      </RowGroup>
      {account.is_active ? (
        <RowCaption
          tone={hasBalance ? "warning" : "quiet"}
          text={
            hasBalance
              ? `Сейчас на счёте ${money(account.balance)} — сначала `
                + "переведите остаток на другой счёт или спишите операцией."
              : hasHistory
                ? "Счёт исчезнет из списков и форм оплаты. История, отчёты и "
                  + "документы сохранятся — открыть снова можно в «Закрытых "
                  + "счетах»."
                : "Операций по счёту не было, поэтому он удаляется насовсем. "
                  + "Восстановить будет нельзя."
          }
        />
      ) : null}
    </>
  );
}
