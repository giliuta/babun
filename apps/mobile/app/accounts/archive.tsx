import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { RowGroup } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import { deleteAccountAlert } from "@/features/finances/account-alerts";
import { accountIcon } from "@/features/finances/account-ui";
import {
  useAccountsWithBalances,
  useDeleteAccount,
  useReopenAccount,
  useSoftCloseAccount,
  type AccountWithBalance,
} from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { useThemeColors } from "@/theme/colors";

// ЗАКРЫТЫЕ СЧЕТА — СВОЙ МАРШРУТ, А НЕ ВЕТКА СПИСКА (ТЗ §5.6, §13/С7).
//
// Раньше архив жил параметром `/accounts?archived=1`: тот же экран рисовал сам
// себя поверх себя, второй раз тянул все запросы счетов и держал в голове
// ветку «а это архив» в каждом состоянии. Теперь это отдельная страница, и
// дверь в неё одна: строка «Закрытые счета» на странице «Счета» (за ползунками
// панели и шестерёнкой «Финансов», владелец 2026-09-15).
//
// ТАП — ТА ЖЕ ШТОРКА ПРАВКИ, ЧТО У ОТКРЫТОГО СЧЁТА (владелец 2026-09-15: «я
// могу также тапнуть на тот же созданный и то же самое редактировать»).
// «Открыть снова» живёт в ней словом и здесь — левой кромкой.
//
// ЦИФРЫ ЗДЕСЬ НЕТ. У закрытого счёта справа пусто, а не «€0»: ноль в денежной
// колонке читается как правда о деньгах («на счету пусто»), хотя означает
// совсем другое — счёт не участвует в подсчётах вовсе. Слово «Закрыт» тоже
// снято (2026-09-23): страница называется «Закрытые счета». Исключение ровно
// одно: если на закрытом счёте остались деньги, сумма
// печатается янтарём. Такой счёт закрыли, не сдав остаток, и эти деньги не
// видно больше нигде в продукте — единственное место, где о них можно
// сказать, это здесь.

export default function AccountsArchiveScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  // Включая архивные команды: счёт живёт дольше своей команды, и подпись
  // «Команда удалена» честнее пустоты.
  const teamsQuery = useTeams({ includeInactive: true });

  const closed = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => !account.is_active),
    [accountsQuery.data],
  );
  const teamById = useMemo(
    () => new Map((teamsQuery.data ?? []).map((team) => [team.id, team])),
    [teamsQuery.data],
  );

  const reopen = useReopenAccount();
  const close = useSoftCloseAccount();
  const remove = useDeleteAccount();
  // `id` отдельно от `open`: уезжающая шторка не меняет содержимое на полпути.
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  // ОТКРЫТИЕ ОБРАТИМО — значит тостом с «Отменить», а не вопросом до
  // действия (тот же приём, что у перевода и архива клиентов). Вопрос перед
  // нажатием читают как формальность; кнопка рядом с уже случившимся — нет.
  const openAgain = (account: AccountWithBalance, left: boolean) => {
    reopen.mutate(account.id, {
      // ОТМЕНА ПРЕДЛАГАЕТСЯ ТОЛЬКО ТАМ, ГДЕ ОНА СРАБОТАЕТ. Счёт с остатком
      // закрыть нельзя (`guard_account_financial_history`) — у янтарной строки
      // кнопка «Отменить» отбивалась бы ВСЕГДА. Такой счёт закрывают со
      // страницы «Счета»: там есть единственная рабочая дорога — сдать остаток.
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
                      toast(`Не удалось закрыть счёт: ${e.message}`, "error"),
                  }),
              },
        ),
      // Кромку свайпа погасить нельзя — у неё нет подписи, которую читают до
      // жеста. Значит причина обязана приехать словами В ОТВЕТ: сырое
      // «Network request failed» не отвечает на единственный вопрос —
      // открылся счёт или нет.
      onError: (e) =>
        toast(
          isOnline()
            ? `Не удалось открыть счёт: ${e.message}`
            : "Без сети счёт не открыть — счета живут на сервере.",
          "error",
        ),
    });
  };

  // СТЕРЕТЬ — ТОЛЬКО ОТСЮДА И ТОЛЬКО ПУСТОЙ (владелец 2026-09-23: «добавить в
  // архив и потом удалить… по нашей архитектуре»). Вопрос перед действием
  // обязателен: удаление безвозвратно, «Отменить» после него нечем.
  const erase = (account: AccountWithBalance) => {
    const text = deleteAccountAlert(account.name, account.balance);
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm, destructive: true },
      () =>
        remove.mutateAsync(account.id).then(
          () => toast(`Счёт «${account.name}» удалён`),
          (e: unknown) =>
            toast(
              isOnline()
                ? `Не удалось удалить счёт: ${e instanceof Error ? e.message : String(e)}`
                : "Без сети счёт не удалить — счета живут на сервере.",
              "error",
            ),
        ),
    );
  };

  // ЧЕЙ БЫЛ СЧЁТ. У счёта один владелец — команда (владелец 2026-08-15).
  // Счёт без неё остался от старой схемы «общего счёта»: молчать о нём нельзя,
  // деньги на нём настоящие.
  const subtitle = (account: AccountWithBalance): string =>
    account.brigade_id
      ? (teamById.get(account.brigade_id)?.name ?? "Команда удалена")
      : "Без команды";

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending (§8): без сети запрос стоит
  // в paused и остаётся pending навсегда — экран крутил бы спиннер вечно.
  const hasData =
    accountsQuery.data !== undefined && teamsQuery.data !== undefined;
  const loadError = hasData
    ? null
    : (accountsQuery.error ?? teamsQuery.error ?? null);
  const retry = () => {
    void accountsQuery.refetch();
    void teamsQuery.refetch();
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Закрытые счета"
        // Холодная ссылка прямо сюда: «назад» ведёт к единственной двери этой
        // страницы, а не на календарь, куда примитив уводит пустую историю.
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace("/accounts/settings")
        }
      />
      {!hasData && !loadError ? (
        online ? (
          <EmptyState state="loading" fill title="Загружаем счета" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счета ещё не загружены на это устройство"
            action={{ label: "Повторить", onPress: retry }}
          />
        )
      ) : loadError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : closed.length === 0 ? (
        <EmptyState
          fill
          title="Нет закрытых счетов"
          subtitle="Закрытый счёт сохраняет свою историю и может быть открыт снова"
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <RowGroup footer="Закрытый счёт не входит ни в один итог и не предлагается при приёме денег. История операций у него сохраняется.">
            {closed.map((account, index) => {
              const left = moneySign(account.balance) !== 0;
              return (
                <View key={account.id}>
                  {/* Линия начинается под текстом: 16 поля + 28 плитки + 12 зазора. */}
                  {index > 0 ? <Divider inset={56} /> : null}
                  <SwipeRow
                    // ВОЗВРАТ — НА ЛЕВОЙ КРОМКЕ, УДАЛЕНИЕ — НА ПРАВОЙ
                    // (владелец 2026-09-10: «свайп вправо — это удалить, а не
                    // скрыть»). «Открыть» — то же по смыслу, что «Показать» у
                    // скрытой услуги или метки, и живёт там же, тем же
                    // зелёным. Правая кромка есть только у счёта БЕЗ
                    // операций: операции держат доход и отчёты, и сервер
                    // такой счёт не отдаст (`on delete restrict`) — кромка,
                    // которая всегда отбивается, хуже её отсутствия.
                    label={account.has_history ? undefined : "Удалить"}
                    color={t.danger}
                    accessibilityLabel={`Удалить счёт ${account.name}`}
                    onAction={
                      account.has_history ? undefined : () => erase(account)
                    }
                    leading={{
                      label: "Открыть",
                      color: t.success,
                      icon: RotateCcw,
                      accessibilityLabel: `Открыть счёт ${account.name} снова`,
                      onAction: () => openAgain(account, left),
                    }}
                  >
                    <SettingsRow
                      // ТОТ ЖЕ ОБЛИК, ЧТО В ЖИВОМ СПИСКЕ (живой прогон
                      // 2026-09-23): квадратная плитка блока «Вид» и заливка
                      // строки. Здесь стоял старый диск — у счёта без цвета
                      // он превращался в голый глиф, и имена в соседних
                      // строках стояли вразнобой.
                      appearance={{
                        color: account.color,
                        icon: account.icon,
                        fallback: accountIcon(account),
                      }}
                      title={account.name}
                      sub={subtitle(account)}
                      // Слова «Закрыт» в строке нет: страница так и
                      // называется, и повтор в каждой строке — шум. Справа
                      // остаётся только то, что просит внимания, —
                      // невыведенные деньги.
                      value={left ? money(account.balance) : undefined}
                      valueColor={left ? t.warning : undefined}
                      a11yLabel={[
                        account.name,
                        subtitle(account),
                        left
                          ? `закрыт с остатком ${money(account.balance)}`
                          : "закрыт",
                      ].join(", ")}
                      // Свайпа для VoiceOver не существует — то же действие
                      // отдаём ротором, теми же словами.
                      a11yActions={[
                        { name: "reopen", label: "Открыть снова" },
                        ...(account.has_history
                          ? []
                          : [{ name: "delete", label: "Удалить" }]),
                      ]}
                      onA11yAction={(name) => {
                        if (name === "reopen") openAgain(account, left);
                        if (name === "delete") erase(account);
                      }}
                      onPress={() => setEditor({ open: true, id: account.id })}
                    />
                  </SwipeRow>
                </View>
              );
            })}
          </RowGroup>
        </ScrollView>
      )}
      <AccountEditorSheet
        visible={editor.open}
        accountId={editor.id}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
    </Screen>
  );
}
