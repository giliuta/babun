import { View } from "react-native";
import { Eye, EyeOff, Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
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
  const t = useThemeColors();
  const reopenAcc = useReopenAccount();
  const hasHistory = account.has_history;
  // Плашки, как во всей шторке (вариант 1, 03.10); объяснений под ними нет —
  // всё нужное говорит вопрос, который задаёт само действие
  // (`use-close-flow`): остаток, перевод, «насовсем».
  const blockBody = { paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4, gap: 2 } as const;

  if (account.is_active) {
    return (
      <SectionCard dense>
        <View style={blockBody}>
          <SelectRow icon={EyeOff} color={t.danger} plain title="Скрыть счёт" onPress={onCloseAccount} />
        </View>
      </SectionCard>
    );
  }

  return (
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
        {/* Стереть можно только пустой: операции держат доход и отчёты
            (сервер: `finance_transactions → accounts on delete restrict`). */}
        {!hasHistory ? (
          <SelectRow icon={Trash2} color={t.danger} plain title="Удалить счёт" onPress={onCloseAccount} />
        ) : null}
      </View>
    </SectionCard>
  );
}
