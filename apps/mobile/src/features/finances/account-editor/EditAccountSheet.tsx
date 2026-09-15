import { useMemo } from "react";
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import { useAccountsWithBalances, useUpdateAccount } from "../accounts";
import {
  ACCOUNT_GONE_SETTINGS,
  OFFLINE_ACCOUNT_EDIT,
} from "../account-alerts";
import { TransferSheet } from "../TransferSheet";
import { AccountCloseGroup } from "./AccountCloseGroup";
import { AccountMoneyGroup } from "./AccountMoneyGroup";
import { AccountNameCard } from "./AccountNameCard";
import { AccountVatGroup } from "./AccountVatGroup";
import { editorView, type EditorView } from "./editor-logic";
import { ACCOUNT_SHEET_RATIO, accountSaver, type AlertError } from "./types";
import { useCloseFlow } from "./use-close-flow";

// ПРАВКА СЧЁТА — режим правки листа счёта (`AccountEditorSheet`). Здесь всё,
// что было на странице настроек счёта (владелец 2026-09-15: «тапнуть на тот же
// созданный и то же самое редактировать уже созданный счёт»). Порядок: имя и
// вид первой строкой → деньги → команда → НДС → закрытие.
//
// КНОПКИ В ФУТЕРЕ НЕТ: каждая строка пишет сама, на уходе из поля или на
// переключении, и каждая сообщает о своём отказе (`accountSaver`). Закрытый
// счёт открывается тем же листом — с «Открыть счёт снова».
export function EditAccountSheet({
  visible,
  accountId,
  onClose,
}: {
  visible: boolean;
  accountId: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const online = useIsOnline();
  const doorway = useSheetDoorway();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );
  // ВСЕ команды, включая архивные: счёт живёт дольше своей команды, и её имя
  // нужно и строке «Команда», и листу перевода.
  const teamsQuery = useTeams({ includeInactive: true });
  const teamById = useMemo(
    () => new Map((teamsQuery.data ?? []).map((team) => [team.id, team])),
    [teamsQuery.data],
  );
  const activeTeams = useMemo(
    () => (teamsQuery.data ?? []).filter((team) => team.is_active),
    [teamsQuery.data],
  );
  const update = useUpdateAccount();

  // ПРИЧИНА ОТКАЗА ОБЯЗАНА БЫТЬ ЧИТАЕМОЙ. Мутации счёта помечены NEVER_PAUSE и
  // офлайн падают сразу — сырое «Network request failed» не отвечает на
  // единственный вопрос: сохранилось или нет.
  const alertError: AlertError = (title) => (e) =>
    notify(title, isOnline() ? (e as Error).message : OFFLINE_ACCOUNT_EDIT);
  const save = accountSaver(update, accountId, alertError);
  const flow = useCloseFlow({ onDone: onClose, alertError });

  const view = editorView({
    accountId,
    accounts: accountsQuery.data,
    error: accountsQuery.error,
    online,
  });
  const account = view.kind === "edit" ? view.account : null;

  return (
    <>
      <BottomSheet
        padded={false}
        // Лист уезжает с дороги дважды: на страницу НДС (возвращается по
        // «назад») и на время разговора о закрытии (`use-close-flow`).
        visible={visible && !doorway.parked && !flow.parked}
        onClose={onClose}
        // Имени в шапке нет: оно стоит первой строкой листа, и одно и то же
        // слово дважды в одном кадре — шум.
        title="Настройки счёта"
        subtitle={account && !account.is_active ? "Счёт закрыт" : undefined}
        maxHeightRatio={ACCOUNT_SHEET_RATIO}
        avoidKeyboard
        onExited={flow.onSheetExited}
      >
        {/* Тело — язык страницы (группы строк на прохладном фоне): лист
            заменил собой страницу настроек, и строки в нём те же самые. */}
        <ScrollView
          style={{ flexShrink: 1, backgroundColor: t.canvas }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {account ? (
            <>
              <AccountNameCard account={account} save={save} />
              <AccountMoneyGroup
                account={account}
                accounts={accounts}
                activeTeams={activeTeams}
                teamById={teamById}
                save={save}
                busy={update.isPending}
                alertError={alertError}
              />
              <AccountVatGroup
                account={account}
                save={save}
                busy={update.isPending}
                openPage={(href) => doorway.open(() => router.push(href))}
              />
              <AccountCloseGroup
                account={account}
                onCloseAccount={() => flow.start(account, accounts)}
                alertError={alertError}
              />
            </>
          ) : (
            <EditorNotice
              view={view}
              onRetry={() => void accountsQuery.refetch()}
            />
          )}
        </ScrollView>
      </BottomSheet>
      {/* Перевод остатка ради закрытия — тот же лист, что в футере «Финансов»:
          одна форма движения денег на продукт. Открывается, когда лист счёта
          и вопрос уже уехали. */}
      <TransferSheet
        visible={flow.transfer.visible}
        onClose={flow.transfer.onClose}
        accounts={activeAccounts}
        teamById={teamById}
        presetFromId={flow.transfer.fromId}
        presetToId={flow.transfer.toId}
        presetAmount={flow.transfer.amount}
      />
    </>
  );
}

/** Счёта на руках нет — лист говорит почему. Только слова; «Повторить» у
 *  ошибки — единственное исключение канона 7.1. */
function EditorNotice({
  view,
  onRetry,
}: {
  view: EditorView<unknown>;
  onRetry: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return <EmptyState state="loading" title="Загружаем счёт" />;
    case "gone":
      return (
        <EmptyState
          title={ACCOUNT_GONE_SETTINGS.title}
          subtitle={ACCOUNT_GONE_SETTINGS.message}
        />
      );
    case "failed":
      return (
        <EmptyState
          state="error"
          title="Не удалось загрузить счёт"
          subtitle={view.message}
          action={{ label: "Повторить", onPress: onRetry }}
        />
      );
    case "offline":
      return (
        <EmptyState
          title="Нет сети"
          subtitle="Счёт ещё не загружен на это устройство"
          action={{ label: "Повторить", onPress: onRetry }}
        />
      );
    default:
      return null;
  }
}
