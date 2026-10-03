import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import type { AccountDraft } from "@babun/shared/db/repositories/accounts";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import {
  useAccountsWithBalances,
  useSetAccountHidden,
  useUpdateAccount,
} from "../accounts";
import {
  ACCOUNT_GONE_SETTINGS,
  OFFLINE_ACCOUNT_EDIT,
} from "../account-alerts";
import { TransferSheet } from "../TransferSheet";
import { AccountCloseGroup } from "./AccountCloseGroup";
import { AccountMoneyGroup } from "./AccountMoneyGroup";
import { AccountNameCard } from "./AccountNameCard";
import { editorView, type EditorView } from "./editor-logic";
import { ACCOUNT_SHEET_RATIO, accountSaver, type AlertError } from "./types";
import { useCloseFlow } from "./use-close-flow";

// ПРАВКА СЧЁТА — режим правки листа счёта (`AccountEditorSheet`). Здесь всё,
// что было на странице настроек счёта (владелец 2026-09-15: «тапнуть на тот же
// созданный и то же самое редактировать уже созданный счёт»). Порядок (03.10):
// имя и вид → «Деньги» (на счёте, VAT, перевести) → «Счёт» (оплата записи,
// выписка) → скрыть / удалить.
//
// НАЛОГА У СЧЁТА НЕТ (владелец 2026-09-23: «VAT мы уже пишем в „Итого“, нам
// без разницы — счёт с VAT или без»). Налог решается там, где вносятся
// деньги: в «Итого» записи и клавишами операции; счёт только показывает,
// сколько VAT на нём к уплате (`AccountMoneyGroup`).
//
// «ПРИМЕНИТЬ» В ФУТЕРЕ (владелец 03.10: «в настройках счёта должна быть
// кнопка применить или сохранить, чтоб было всё чётко»). Имя, вид и «В оплате
// записи» копятся черновиком и уходят на сервер одной правкой; закрыть лист с
// черновиком — только после вопроса. Действия («Перевести», «Выписка»,
// «Скрыть», «Удалить») — сразу, это не настройки; черновик они не трогают.
// Скрытый счёт открывается тем же листом — с «Открыть счёт».
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
  const online = useIsOnline();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true, includeHidden: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );
  // ВСЕ команды, включая архивные: счёт живёт дольше своей команды, и её имя
  // нужно листу перевода.
  const teamsQuery = useTeams({ includeInactive: true });
  const teamById = useMemo(
    () => new Map((teamsQuery.data ?? []).map((team) => [team.id, team])),
    [teamsQuery.data],
  );
  const update = useUpdateAccount();
  const setHidden = useSetAccountHidden();
  const toast = useToast();

  // ПРИЧИНА ОТКАЗА ОБЯЗАНА БЫТЬ ЧИТАЕМОЙ. Мутации счёта помечены NEVER_PAUSE и
  // офлайн падают сразу — сырое «Network request failed» не отвечает на
  // единственный вопрос: сохранилось или нет.
  const alertError: AlertError = (title) => (e) =>
    notify(title, isOnline() ? (e as Error).message : OFFLINE_ACCOUNT_EDIT);
  const save = accountSaver(update, accountId, alertError);
  const flow = useCloseFlow({ onDone: onClose, alertError });

  // ЧЕРНОВИК ЛИСТА. Новый счёт или новое открытие — с чистого листа.
  const [pending, setPending] = useState<Partial<AccountDraft>>({});
  useEffect(() => setPending({}), [accountId, visible]);

  // «ВЫПИСКА» — СТРАНИЦА ПОВЕРХ «СЧЕТОВ» (владелец 03.10: сначала превью,
  // потом файл). Лист модальный и над страницей висел бы, поэтому он сперва
  // уезжает, страница открывается после его ухода, а «назад» возвращает лист
  // с тем же черновиком — родитель его не закрывал.
  const router = useRouter();
  const [statement, setStatement] = useState<"idle" | "leaving" | "away">("idle");
  useEffect(() => setStatement("idle"), [accountId, visible]);
  useFocusEffect(
    useCallback(() => {
      setStatement((now) => (now === "away" ? "idle" : now));
    }, []),
  );
  const stage = (patch: Partial<AccountDraft>) => setPending((prev) => ({ ...prev, ...patch }));
  const dirty = Object.keys(pending).length > 0;

  const view = editorView({
    accountId,
    accounts: accountsQuery.data,
    error: accountsQuery.error,
    online,
  });
  const saved = view.kind === "edit" ? view.account : null;
  // Лист показывает счёт С ЧЕРНОВИКОМ поверх — как он станет после «Применить».
  const account = saved ? { ...saved, ...pending } : null;

  const guard = useGuardedClose({
    dirty,
    busy: update.isPending,
    onClose,
    message: "Изменения счёта не сохранятся.",
  });

  const apply = async () => {
    if (!saved || !dirty) return;
    const patch = { ...pending };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) {
        notify("Дайте счёту название", "Без названия счёт не узнать в оплате и переводах.");
        return;
      }
      if (name === saved.name) delete patch.name;
      else patch.name = name;
    }
    if (Object.keys(patch).length === 0) {
      setPending({});
      onClose();
      return;
    }
    const ok = await save(patch, "Не удалось сохранить счёт");
    if (!ok) return;
    setPending({});
    onClose();
  };

  return (
    <>
      <BottomSheet
        padded={false}
        // Лист уезжает с дороги на время разговора о скрытии или удалении
        // (`use-close-flow`).
        visible={visible && !flow.parked && !guard.hidden && statement === "idle"}
        onClose={guard.close}
        // Имени в шапке нет: оно стоит первой строкой листа, и одно и то же
        // слово дважды в одном кадре — шум.
        title="Настройки счёта"
        subtitle={
          account && !account.is_active
            ? "Счёт закрыт"
            : account?.is_hidden
              ? "Скрытый счёт"
              : undefined
        }
        maxHeightRatio={ACCOUNT_SHEET_RATIO}
        avoidKeyboard
        onExited={() => {
          flow.onSheetExited();
          guard.onExited();
          if (statement === "leaving") {
            setStatement("away");
            router.push(`/accounts/${encodeURIComponent(accountId)}/statement` as Href);
          }
        }}
        footer={
          // Лист без полей (`padded={false}`): отступ у кнопки свой — та же
          // ширина, что у кнопок внизу страниц. Кнопка на месте всегда — и
          // пока счёт грузится, и без сети: лист не меняет высоту.
          <View style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
            <GradientButton
              label="Применить"
              disabled={!account || !dirty || update.isPending}
              onPress={() => void apply()}
            />
          </View>
        }
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
              <AccountNameCard account={account} stage={stage} />
              <AccountMoneyGroup
                account={account}
                accounts={accounts}
                stage={stage}
                busy={update.isPending}
                onTransfer={() => flow.startTransfer(account)}
                onStatement={() => setStatement("leaving")}
              />
              <AccountCloseGroup
                account={account}
                onHide={() => {
                  // «СКРЫТЬ» ⇄ «ПОКАЗАТЬ» — СРАЗУ, БЕЗ ВОПРОСА (владелец 03.10:
                  // скрытый счёт работает, виден только на странице «Счета»).
                  // Прятать — вместе с «В оплате записи»: черновик этого
                  // тумблера уходит, иначе «Применить» упёрся бы в запрет базы.
                  const hide = !account.is_hidden;
                  if (hide) {
                    setPending(({ show_in_payments: _drop, ...rest }) => rest);
                  }
                  setHidden.mutateAsync({ id: account.id, hidden: hide }).then(
                    () =>
                      toast(
                        hide
                          ? `Счёт «${account.name}» скрыт — виден только в «Счетах»`
                          : `Счёт «${account.name}» снова виден`,
                      ),
                    alertError(hide ? "Не удалось скрыть счёт" : "Не удалось показать счёт"),
                  );
                }}
                onDelete={() => flow.start(account, accounts)}
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
