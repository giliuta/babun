import { money, moneySign } from "@babun/shared/common/utils/money";
import { ActionRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { useReopenAccount, type AccountWithBalance } from "../accounts";
import type { AlertError } from "./types";

// ПОСЛЕДНЯЯ ГРУППА ЛИСТА — ПО АРХИТЕКТУРЕ «СКРЫТЬ → АРХИВ → СТЕРЕТЬ»
// (владелец 2026-09-23: «добавить их в архив и потом удалить… чтоб всё
// соблюдалось по нашей архитектуре»; тот же закон, что у календарей 21.09).
//
//   • открытый счёт — «Скрыть счёт»: то же слово и то же действие, что свайп
//     на странице «Счета»; счёт уходит в «Закрытые счета», даже пустой;
//   • закрытый — «Открыть счёт снова», а у счёта без операций ещё и «Удалить
//     счёт» (насовсем);
//   • закрытый с операциями не стирается: операции держат доход и отчёты
//     (сервер: `finance_transactions → accounts on delete restrict`), и
//     подпись говорит это до нажатия.
//
// Сам вопрос и перевод остатка живут в `use-close-flow`: из открытого листа
// вопрос не показать, и лист на это время уезжает.
export function AccountCloseGroup({
  account,
  onCloseAccount,
  alertError,
}: {
  account: AccountWithBalance;
  /** «Скрыть» у открытого, «Удалить» у закрытого — начать разговор. */
  onCloseAccount: () => void;
  alertError: AlertError;
}) {
  const reopenAcc = useReopenAccount();
  const hasHistory = account.has_history;
  const hasBalance = moneySign(account.balance) !== 0;

  if (account.is_active) {
    return (
      <>
        <RowGroup>
          <ActionRow label="Скрыть счёт" tone="danger" onPress={onCloseAccount} />
        </RowGroup>
        <RowCaption
          tone={hasBalance ? "warning" : "quiet"}
          text={
            hasBalance
              ? `Сейчас на счёте ${money(account.balance)} — сначала `
                + "переведите остаток на другой счёт или спишите операцией."
              : "Счёт уйдёт в «Закрытые счета» и исчезнет из оплаты. История "
                + "сохранится; вернуть счёт или стереть пустой можно там."
          }
        />
      </>
    );
  }

  return (
    <>
      <RowGroup>
        {/* ЗАКРЫТЫЙ СЧЁТ ОТКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, без вопроса: действие
            обратимо, и лист остаётся на месте — дальше счёт правится как
            любой другой. */}
        <ActionRow
          label="Открыть счёт снова"
          dimmed={reopenAcc.isPending}
          onPress={() =>
            void reopenAcc
              .mutateAsync(account.id)
              .catch(alertError("Не удалось открыть счёт"))
          }
        />
        {!hasHistory ? (
          <ActionRow
            label="Удалить счёт"
            tone="danger"
            separated
            onPress={onCloseAccount}
          />
        ) : null}
      </RowGroup>
      <RowCaption
        text={
          hasHistory
            ? "По счёту есть операции — стереть его нельзя: они держат доход "
              + "и отчёты. В итоги и оплату закрытый счёт не входит."
            : "Операций по счёту не было, поэтому он удаляется насовсем. "
              + "Восстановить будет нельзя."
        }
      />
    </>
  );
}
