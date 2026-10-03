import { View } from "react-native";
import { Eye, EyeOff, Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
import { useReopenAccount, type AccountWithBalance } from "../accounts";
import type { AlertError } from "./types";

// ПОСЛЕДНЯЯ ГРУППА ЛИСТА — ТЕ ЖЕ ДВА СЛОВА, ЧТО У СВАЙПОВ СТРОКИ:
//   • открытый счёт — «Скрыть счёт» (серым вниз списка) и «Удалить счёт»;
//   • закрытый — «Открыть счёт снова» и «Удалить счёт».
// «Удалить» уводит в «Удалённые счета» на 30 дней, как клиентов (владелец
// 03.10); счёт с операциями там лежит без срока и возвращается оттуда же.
//
// Сам вопрос и перевод остатка живут в `use-close-flow`: из открытого листа
// вопрос не показать, и лист на это время уезжает.
export function AccountCloseGroup({
  account,
  onHide,
  onDelete,
  alertError,
}: {
  account: AccountWithBalance;
  /** «Скрыть счёт» — начать разговор о скрытии. */
  onHide: () => void;
  /** «Удалить счёт» — начать разговор об удалении в «Удалённые счета». */
  onDelete: () => void;
  alertError: AlertError;
}) {
  const t = useThemeColors();
  const reopenAcc = useReopenAccount();
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
            <SelectRow icon={EyeOff} color={t.warning} plain title="Скрыть счёт" onPress={onHide} />
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
          {/* ЗАКРЫТЫЙ СЧЁТ ОТКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, без вопроса: действие
              обратимо, и лист остаётся на месте. */}
          <SelectRow
            icon={Eye}
            color={t.accent}
            plain
            title="Открыть счёт снова"
            disabled={reopenAcc.isPending}
            onPress={() =>
              void reopenAcc
                .mutateAsync(account.id)
                .catch(alertError("Не удалось открыть счёт"))
            }
          />
        </View>
      </SectionCard>
      {remove}
    </>
  );
}
