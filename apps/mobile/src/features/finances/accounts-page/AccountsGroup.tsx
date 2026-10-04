import { View } from "react-native";
import { money } from "@babun/shared/common/utils/money";
import { ReorderList } from "@/components/ui/ReorderList";
import { RowGroupHeader } from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import type { AccountWithBalance } from "../accounts";
import { sumAccountBalances } from "../accounts-sections";
import { ACCOUNT_ROW_H, AccountRow } from "./AccountRow";
import { accountRowMark } from "./page-rules";

// ГРУППА СЧЕТОВ ОДНОЙ КОМАНДЫ НА СТРАНИЦЕ «СЧЕТА» — вынесена из
// `app/accounts/settings.tsx` (03.10, когда у страницы появился режим
// «Только видит»): страница выросла за 400 строк.

export function AccountsGroup({
  title,
  accounts,
  canEdit,
  onReorder,
  onDraggingChange,
  onEdit,
  onHide,
  onDelete,
  onReopen,
}: {
  title: string | null | undefined;
  accounts: AccountWithBalance[];
  /** «Счета: Только видит» — строки без ручек, кромок и правки. */
  canEdit: boolean;
  onReorder: (ids: string[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  onEdit: (account: AccountWithBalance) => void;
  /** Скрывает только владелец (`accounts_hidden_owner_only`). */
  onHide?: (account: AccountWithBalance) => void;
  onDelete: (account: AccountWithBalance) => void;
  onReopen: (account: AccountWithBalance) => void;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      {/* ПОДЫТОГ СТОИТ НАД ГРУППОЙ, А НЕ ПОД НЕЙ: это заголовок раздела с
          числом, как везде в продукте. У компании с одной командой имени
          нет — тогда строку называет слово «На счетах»: сумма без подписи
          читается как чей-то остаток. */}
      <RowGroupHeader
        title={title ?? "На счетах"}
        value={money(
          // Скрытый счёт в сумму не входит — как на плитке «Счета»
          // (владелец 03.10: «не считать»).
          sumAccountBalances(accounts.filter((account) => account.is_active && !account.is_hidden)),
        )}
      />
      {/* ПОРЯДОК — РУЧКОЙ, КАК ВЕЗДЕ (владелец 2026-09-12: «шесть точек
          справа для передвижения… везде одно и то же»). Каждая группа — свой
          список: `position` нумеруется внутри команды, и строка чужой команды
          между ними ничего не значит. ПОРЯДОК НЕ ПЕРЕАДРЕСУЕТ ДЕНЬГИ:
          маршрут оплаты держит «Основной счёт команды» в правке счёта. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        {canEdit ? (
          <ReorderList
            items={accounts}
            rowHeight={ACCOUNT_ROW_H}
            spaced
            handleInside
            labelFor={(account) => account.name}
            onReorder={onReorder}
            onDraggingChange={onDraggingChange}
          >
            {(account, _index, handle) => (
              <AccountRow
                account={account}
                mark={account.is_active ? accountRowMark(account) : "Закрыт"}
                handle={handle}
                onPress={() => onEdit(account)}
                onHide={onHide ? () => onHide(account) : undefined}
                onDelete={() => onDelete(account)}
                hidden={!!account.is_hidden}
                closed={account.is_active ? null : { onReopen: () => onReopen(account) }}
              />
            )}
          </ReorderList>
        ) : (
          // «Только видит» — те же строки без ручек, кромок и правки.
          <View style={{ gap: 8 }}>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                mark={account.is_active ? accountRowMark(account) : "Закрыт"}
                handle={null}
                hidden={!!account.is_hidden}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
