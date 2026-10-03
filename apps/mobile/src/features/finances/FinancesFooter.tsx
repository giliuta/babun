import { useState } from "react";
import { Text, View } from "react-native";
import type { DebtDirection } from "@babun/shared/local/finance/debt";
import { GradientButton } from "@/components/ui/GradientButton";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import { AccountEditorSheet } from "./account-editor/AccountEditorSheet";
import type { AccountWithBalance } from "./accounts";
import { accountsFooterAction, TRANSFER_NEEDS_SECOND } from "./accounts-footer";
import type { HomeView } from "./FinanceOverview";
import { TransferSheet } from "./TransferSheet";

// ГЛАВНОЕ ДЕЙСТВИЕ «ФИНАНСОВ» СЛЕДУЕТ ЗА ОТКРЫТОЙ ПАНЕЛЬЮ (владелец
// 2026-08-12). Кнопка стоит на одном месте — том же, что «Создать клиента» на
// вкладке «Клиенты», — но делает то, чего человек хочет ЗДЕСЬ:
//   • счета     → «Сделать перевод»; «Добавить счёт» — только когда у
//                 команды нет ни одного счёта (`accounts-footer.ts`);
//   • документы → новый инвойс, а на срезе «Чеки» — новый чек: с 20.09
//                 чек тоже выписывают руками, кнопкой;
//   • долги     → свой долг;
//   • остальное → операция, то есть доход или расход.
// Экран берёт только верхний отступ (edges=["top"]), иначе нижняя безопасная
// зона поднимала кнопку выше клиентской, и при переходе между вкладками она
// прыгала.
//
// Вынесено из экрана вкладки (2026-09-15): он перерос тысячу строк, а переключатель
// кнопки и два листа счетов — законченный кусок с одним входом.
//
// ЛИСТЫ ПЕРЕВОДА И НОВОГО СЧЁТА ЖИВУТ ЗДЕСЬ. Перевод — тот же лист, что при
// закрытии счёта из его шторки и при «Скрыть» на странице «Счета»: одна форма
// движения денег на продукт. Новый счёт — шторка редактора счёта, та же, что на странице «Счета»
// за ползунками (владелец 2026-09-15: «ещё лучше не полноценная страница, а
// шторка… и там можно полностью всё редактировать»). Открывается на месте,
// команда — та, что выбрана чипом; всё остальное шторка грузит сама.
export function FinancesFooter({
  view,
  debtSide,
  teamById,
  teamId,
  accounts,
  transferAccounts,
  shownAccounts,
  selectedAccountId,
  onIssueInvoice,
  onAddDebt,
  onAddOperation,
  enabled = true,
  reason = null,
  create = { enabled: true, reason: null },
}: {
  view: HomeView;
  debtSide: DebtDirection;
  /** Все команды, включая расформированные: лист перевода подписывает ими
   *  счета, и старая команда обязана остаться названной. */
  teamById: Map<string, Team>;
  /** Команда чипа (без псевдо-команды «Без команды») — пресет нового счёта. */
  teamId: string | null;
  /** Открытые счета ВСЕЙ компании, не срез команды: деньги ходят между всеми
   *  счетами тенанта, и фильтр экрана на перевод не распространяется (иначе
   *  «сдать выручку на счёт другой команды» стало бы невозможно). */
  accounts: AccountWithBalance[];
  /** Счета листа перевода — те же, плюс СКРЫТЫЕ (владелец 03.10: на
   *  скрытый счёт переводят обычным «Перевести»; партнёрам сервер его не
   *  отдаёт вовсе). Нет — лист берёт `accounts`. */
  transferAccounts?: AccountWithBalance[];
  /** Счета на плитках — выбор считается, только если он виден. */
  shownAccounts: readonly AccountWithBalance[];
  selectedAccountId: string | null;
  onIssueInvoice: () => void;
  onAddDebt: () => void;
  onAddOperation: () => void;
  /** Действие экрана открыто уровнем ЭТОГО календаря (этап 2 доступа). `false`
   *  — кнопка серая и не нажимается; `reason` называет причину словами над
   *  ней («Только просмотр»). У закрытого блока причины нет: страница и так
   *  серая по нулям. */
  enabled?: boolean;
  reason?: string | null;
  /** «Добавить счёт» (у команды нет ни одного счёта) — своё право: счёт
   *  заводит строка шестерёнки «Счета», перевод — право «Счета» (03.10). */
  create?: { enabled: boolean; reason: string | null };
}) {
  const t = useThemeColors();
  const toast = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFromId, setTransferFromId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const accountsAction = accountsFooterAction({
    selectedId: selectedAccountId,
    shown: shownAccounts,
    // Второй счёт ищется там же, куда шторка умеет переводить: вместе со
    // скрытыми (накопительный). Иначе один видимый счёт плюс скрытый давали
    // «Для перевода нужен второй счёт» (аудит финансов 03.10).
    company: transferAccounts ?? accounts,
  });
  const creating = view === "accounts" && accountsAction.kind === "create";
  const shownReason = creating ? create.reason : reason;

  const button =
    view === "accounts" ? (
      accountsAction.kind === "transfer" ? (
        <GradientButton
          label="Сделать перевод"
          disabled={!enabled}
          onPress={() => {
            setTransferFromId(accountsAction.fromId);
            setTransferOpen(true);
          }}
        />
      ) : accountsAction.kind === "needs-second" ? (
        <GradientButton
          label="Сделать перевод"
          disabled={!enabled}
          onPress={() => {
            haptics.warning();
            toast(TRANSFER_NEEDS_SECOND, "info");
          }}
        />
      ) : (
        <GradientButton
          label="Добавить счёт"
          disabled={!create.enabled}
          onPress={() => setCreateOpen(true)}
        />
      )
    ) : view === "documents" ? (
      // ОТДЕЛЬНОГО ЧЕКА НЕТ (владелец 2026-09-30: «отдельно чеки пока что не
      // делай»): чек выписывается только на оплату инвойса, на его странице.
      // Поэтому и под «Чеками» главное действие — «Выставить инвойс».
      // Составитель отдельного чека (`/documents/receipt-new`) остался в коде,
      // но двери к нему нет.
      <GradientButton label="Выставить инвойс" disabled={!enabled} onPress={onIssueInvoice} />
    ) : view === "debt" ? (
      // ДОЛГ — СВОЯ СУЩНОСТЬ, И ЗАВОДИТСЯ ОН СВОЕЙ ШТОРКОЙ (владелец
      // 2026-09-10: «почему, когда я нажимаю „Добавить долг“, открывается
      // форма записи? Там должна открываться такая менюшка, только, наверно,
      // другие категории»). У долга есть строка с направлением, и форма
      // спрашивает ровно его вопросы — без счёта и способа оплаты: долг не
      // деньги, деньги будут платежом.
      <GradientButton
        label={debtSide === "incoming" ? "Добавить долг" : "Добавить свой долг"}
        disabled={!enabled}
        onPress={onAddDebt}
      />
    ) : (
      // КНОПКА СЛЕДУЕТ ЗА РАЗРЕЗОМ (владелец 2026-09-08: «нажимаю на доход —
      // внизу меняется кнопка на добавить доход… и вытягивается только по
      // доходу»). Направление уже выбрано плиткой; спрашивать его второй раз
      // в форме незачем.
      <GradientButton
        label={
          view === "income"
            ? "Добавить доход"
            : view === "expense"
              ? "Добавить расход"
              : "Добавить операцию"
        }
        disabled={!enabled}
        onPress={onAddOperation}
      />
    );

  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 6 }}>
        {/* ПРИЧИНА — СЛОВАМИ НАД КНОПКОЙ, как в «Финансах дня»: серая кнопка
            без объяснения читается как поломка. */}
        {shownReason ? (
          <Text
            className="text-center text-[13px]"
            style={{ color: t.sub }}
            maxFontSizeMultiplier={1.3}
          >
            {shownReason}
          </Text>
        ) : null}
        {button}
      </View>
      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={transferAccounts ?? accounts}
        teamById={teamById}
        presetFromId={transferFromId}
      />
      <AccountEditorSheet
        visible={createOpen}
        accountId={null}
        presetTeamId={teamId}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
