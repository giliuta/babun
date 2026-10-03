import { View } from "react-native";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "../accounts";
import { useClosedAccountActions } from "../accounts-page/use-closed-account-actions";

// ПОСЛЕДНЯЯ ГРУППА ЛИСТА — ТЕ ЖЕ ДВА СЛОВА, ЧТО У СВАЙПОВ СТРОКИ:
//   • открытый счёт — «Скрыть счёт» (счёт для себя: работает, виден только на
//     странице «Счета», владелец 03.10; у скрытого — «Показать счёт») и
//     «Удалить счёт»;
//   • скрытый — «Открыть счёт» и «Удалить счёт».
// «Удалить» уводит в «Удалённые счета» на 30 дней, как клиентов (владелец
// 03.10); счёт с операциями там лежит без срока и возвращается оттуда же.
//
// Сам вопрос и перевод остатка живут в `use-close-flow`: из открытого листа
// вопрос не показать, и лист на это время уезжает.
export function AccountCloseGroup({
  account,
  onHide,
  onDelete,
}: {
  account: AccountWithBalance;
  /** «Скрыть счёт» ⇄ «Показать счёт» — сразу, без вопроса. */
  onHide: () => void;
  /** «Удалить счёт» — начать разговор об удалении в «Удалённые счета». */
  onDelete: () => void;
}) {
  const t = useThemeColors();
  const { openAgain } = useClosedAccountActions();
  // Плашки, как во всей шторке (вариант 1, 03.10); объяснений под ними нет —
  // всё нужное говорит вопрос, который задаёт само действие
  // (`use-close-flow`): остаток, перевод, «насовсем».
  const blockBody = { paddingHorizontal: 2, paddingVertical: 2 } as const;

  // КАЖДОЕ ДЕЛО СВОИМ БЛОКОМ (владелец 03.10: «вообще раздельно можно все
  // эти блоки») — «Скрыть» и «Удалить» не делят одну карточку.
  const remove = (
    <SectionCard dense>
      <View style={blockBody}>
        <SelectRow icon={Trash2} color={t.danger} plain title="Удалить счёт" onPress={onDelete} />
      </View>
    </SectionCard>
  );

  if (account.is_active) {
    return (
      <>
        <SectionCard dense>
          <View style={blockBody}>
            {account.is_hidden ? (
              <SelectRow icon={Eye} color={t.accent} plain title="Показать счёт" onPress={onHide} />
            ) : (
              <SelectRow icon={EyeOff} color={t.warning} plain title="Скрыть счёт" onPress={onHide} />
            )}
          </View>
        </SectionCard>
        {remove}
      </>
    );
  }

  return (
    <>
      <SectionCard dense>
        <View style={blockBody}>
          {/* СКРЫТЫЙ СЧЁТ ОТКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, без вопроса: действие
              обратимо, и лист остаётся на месте. Значок, цвет и тост «Счёт
              открыт · Отменить» — те же, что у свайпа «Открыть»
              (`useClosedAccountActions`): одно действие говорит одинаково. */}
          <SelectRow
            icon={RotateCcw}
            color={t.success}
            plain
            title="Открыть счёт"
            onPress={() => openAgain(account)}
          />
        </View>
      </SectionCard>
      {remove}
    </>
  );
}
